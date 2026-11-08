//! Imports: the user's files and links become rows, rows become library tracks through
//! metadata matching. Parsers here are pure; the job lives next to the library store.

pub mod cascade;
pub mod export;
pub mod job;
pub mod matcher;
pub mod parse;
pub mod spotify;

pub use parse::{MAX_FILE_BYTES, MAX_ROWS, ParseError, Parsed, SourceRow, parse_file};
