use solana_program::{
    program_pack::{IsInitialized, Sealed},
    pubkey::Pubkey,
    hash::Hash,
};


pub const BIT_DEPTH: usize = 4;
pub const NODE_SIZE: usize = 2_usize.pow(BIT_DEPTH as u32);

use crate::{util::Serdes};
use borsh::{BorshDeserialize, BorshSerialize};

/**
 * State for main program node
 */
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct HAMTState {
    pub is_initialized: bool,
    pub root_pubkey: Pubkey,
}

impl Sealed for HAMTState {}
impl Serdes for HAMTState {}

impl IsInitialized for HAMTState {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

/**
 * State for tree nodes
 */
#[derive(Clone, Copy, Default, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct HAMTSlot {
    pub value: u64,
    pub key_hash: Hash,
    pub link: Pubkey,
}

impl HAMTSlot {
    pub fn is_empty(&self) -> bool {
        self.key_hash == Hash::default() && self.link == Pubkey::default()
    }

    pub fn is_value(&self) -> bool {
        self.key_hash != Hash::default()
    }

    pub fn is_link(&self) -> bool {
        self.link != Pubkey::default()
    }
}

impl Sealed for HAMTSlot {}
impl Serdes for HAMTSlot {}

#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct HAMTNode {
    pub values: [HAMTSlot; NODE_SIZE],
}

impl Sealed for HAMTNode {}
impl Serdes for HAMTNode {}
