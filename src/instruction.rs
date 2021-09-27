use crate::{util::Serdes};
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub enum HAMTInstruction {
    InitHAMT,
    SetValue,
}
impl Serdes for HAMTInstruction {}

/// Initializes a new HAMT with a state account and root node.
///
/// Accounts expected:
///
/// 0. `[signer]` The account of the person initializing the escrow
/// 1. `[writable]` Account to hold HAMT state data (33 bytes)
/// 2. `[]` The rent sysvar
/// 3. `[writable]` Account to hold the root node's data (1152 bytes)
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct InitHAMT { 
    kind: HAMTInstruction
}

impl Serdes for InitHAMT {}

/// Sets a value in the HAMT
///
/// Accounts expected:
///
/// 0. `[signer]` The account of the person initializing the escrow
/// 1. `[]` HAMT State account
/// 2-(n-1). `[]` All HAMT nodes where key maps to a link.
/// n. `[writable]` The first node that isn't a link for the key slot 
///     where data will be written if there is no collision or new link.
///     will be created if there is.
/// (n+1)-(n+m). Newly created nodes for collisions.
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct SetValue {
    pub kind: HAMTInstruction,
    pub key: String,
    pub value: u64,
}

impl Serdes for SetValue {}
