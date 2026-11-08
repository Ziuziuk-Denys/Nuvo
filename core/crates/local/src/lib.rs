//! Local music folders: walking them without following links, reading tags and covers, and
//! writing tags into saved copies. No database and no async; the daemon drives both.

pub mod open;
pub mod save;
pub mod tags;
pub mod walk;
