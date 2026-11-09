pub mod canon;
pub mod keys;
pub mod rewards;
pub mod suppress;
pub mod features;
pub mod pmi;
pub mod pool;
pub mod model;
pub mod rank;
pub mod feedback;
pub mod mixes;
pub mod starters;

use nuvo_store::StoreError;
use rusqlite::Connection;

// One SAVEPOINT: writes commit together with one disk sync, or not at all; nests safely
pub(crate) fn savepoint<T>(conn: &Connection, name: &str, f: impl FnOnce() -> Result<T, StoreError>) -> Result<T, StoreError> {
    conn.execute_batch(&format!("SAVEPOINT {name}"))?;
    match f() {
        Ok(value) => {
            conn.execute_batch(&format!("RELEASE {name}"))?;
            Ok(value)
        }
        Err(err) => {
            // ROLLBACK TO keeps the savepoint open; RELEASE ends it so no transaction is left behind.
            let _ = conn.execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"));
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn savepoint_commits_or_rolls_back_and_leaves_no_transaction_open() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (x INTEGER)").unwrap();
        savepoint(&conn, "ok", || Ok(conn.execute("INSERT INTO t VALUES (1)", [])?)).unwrap();
        let failed: Result<(), StoreError> = savepoint(&conn, "bad", || {
            conn.execute("INSERT INTO t VALUES (2)", [])?;
            savepoint(&conn, "inner", || Ok(conn.execute("INSERT INTO t VALUES (3)", [])?))?;
            Err(StoreError::Invalid("boom".into()))
        });
        assert!(failed.is_err());
        assert!(conn.is_autocommit(), "no transaction left open");
        let rows: Vec<i64> = conn.prepare("SELECT x FROM t").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(rows, [1]);
    }
}
