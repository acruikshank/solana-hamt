use std::cmp;


use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_pack::{IsInitialized},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
    hash::{ Hash, hash },
    msg,
};

use crate::{
    error::HAMTError,
    instruction::{ SetValue },
    util::Serdes,
    state::{ BIT_DEPTH, HAMTState, HAMTNode }
};

enum TraverseState {
    Finding {},
    Collision {
        collision_hash: Hash,
        collision_value: u64,
    }
}

pub struct Processor;
impl Processor {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        let instruction_type = instruction_data[0];

        if instruction_type == 0 {
            return Self::process_init_hamt(accounts, program_id)
        }
        
        else if instruction_type == 1 {
            let instruction = SetValue::unpack(instruction_data)?;
            return Self::process_set_value(accounts, instruction.key, instruction.value, program_id)
        }

        Err(HAMTError::InvalidInstruction.into())
    }

    fn process_init_hamt(
        accounts: &[AccountInfo],
        _program_id: &Pubkey,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();

        let _setter = next_account_info(account_info_iter)?;
        let hamt_account = next_account_info(account_info_iter)?;
        let rent = &Rent::from_account_info(next_account_info(account_info_iter)?)?;

        if !rent.is_exempt(hamt_account.lamports(), hamt_account.data_len()) {
            return Err(HAMTError::NotRentExempt.into());
        }

        let root_account = next_account_info(account_info_iter)?;

        // initialize root
        let mut hamt_info = HAMTState::unpack(&hamt_account.data.borrow())?;
        if hamt_info.is_initialized() {
            return Err(HAMTError::InvalidInstruction.into());
        }
        hamt_info.is_initialized = true;
        hamt_info.root_pubkey = *root_account.key;

        if !rent.is_exempt(root_account.lamports(), root_account.data_len()) {
            return Err(HAMTError::NotRentExempt.into());
        }

        HAMTState::pack(&hamt_info, &mut hamt_account.data.borrow_mut());

        Ok(())
    }

    fn process_set_value(
        accounts: &[AccountInfo],
        key: String,
        value: u64,
        _program_id: &Pubkey,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();

        let _setter = next_account_info(account_info_iter)?;
        let hamt_account = next_account_info(account_info_iter)?;
        let rent = &Rent::from_account_info(next_account_info(account_info_iter)?)?;

        // State must already be initialized
        let hamt_info = HAMTState::unpack(&hamt_account.data.borrow())?;
        if !hamt_info.is_initialized() {
            return Err(HAMTError::InvalidInstruction.into());
        }
        
        let mut next_addr = hamt_info.root_pubkey;
        let mut traverse_state = TraverseState::Finding {};

        let key_hash = hash(key.as_bytes());
        let mut hash_idx = 0;

        let mut next_account = next_account_info(account_info_iter)?;

        loop {
            let mut node = HAMTNode::unpack(&next_account.data.borrow())?;

            match traverse_state {
                TraverseState::Finding {} => {
                    // validate account has expected address
                    if *next_account.key != next_addr {
                        return Err(HAMTError::InvalidInstruction.into())
                    }

                    let slot_idx = hash_prefix(hash_idx, key_hash);
                    let slot = node.values[slot_idx as usize];
                    hash_idx += BIT_DEPTH;

                    if slot.is_link() {
                        // step one edge
                        next_addr = slot.link;
                        next_account = next_account_info(account_info_iter)?;                    
                    } else if slot.is_value() && slot.key_hash != key_hash {
                        // collision, extend graph
                        traverse_state = TraverseState::Collision { 
                            collision_hash: slot.key_hash, 
                            collision_value: slot.value
                        };

                        let current_account = next_account;
                        next_account = next_account_info(account_info_iter)?;                    

                        node.values[slot_idx as usize].key_hash = Hash::default();
                        node.values[slot_idx as usize].value = 0;
                        node.values[slot_idx as usize].link = *next_account.key;
                        HAMTNode::pack(&node, &mut current_account.data.borrow_mut());

                    } else {
                        // empty or same value, update
                        node.values[slot_idx as usize].key_hash = key_hash;
                        node.values[slot_idx as usize].value = value;
                        HAMTNode::pack(&node, &mut next_account.data.borrow_mut());

                        return Ok(())
                    }
                }
                TraverseState::Collision { collision_hash, collision_value } => {                    
                    if !rent.is_exempt(next_account.lamports(), next_account.data_len()) {
                        return Err(HAMTError::NotRentExempt.into());
                    }

                    let slot_idx = hash_prefix(hash_idx, key_hash);
                    let collision_idx = hash_prefix(hash_idx, collision_hash);
                    hash_idx += BIT_DEPTH;

                    if collision_idx != slot_idx {
                        // collision value is different in this node, write both and exit
                        node.values[slot_idx as usize].key_hash = key_hash;
                        node.values[slot_idx as usize].value = value;
                        node.values[collision_idx as usize].key_hash = collision_hash;
                        node.values[collision_idx as usize].value = collision_value;
                        HAMTNode::pack(&node, &mut next_account.data.borrow_mut());

                        return Ok(())
                    }

                    // another collision, write link and continue
                    let current_account = next_account;
                    next_account = next_account_info(account_info_iter)?;
                    node.values[slot_idx as usize].link = *next_account.key;
                    HAMTNode::pack(&node, &mut current_account.data.borrow_mut());
                }
            }
        }
    }
}

fn hash_prefix(mut idx: usize, hash: Hash) -> u8 {
    let mut bits_needed = BIT_DEPTH;
    let mut prefix: u8 = 0;
    let hash_bytes = hash.as_ref();

    while bits_needed > 0 {
        let byte = hash_bytes[idx >> 3];
        let offset: usize = idx % 8;

        let bits = cmp::min(8-offset, bits_needed);
        let mask: u8 = ((1<<bits) - 1) << offset;
        prefix += ((byte & mask) >> offset) << (BIT_DEPTH - bits_needed);
        bits_needed -= bits;
        idx += bits;
    }

    prefix
}

#[test]
fn hash_prefix_works() {
    // create special hash from byte array where sequential numbers are stored every 5 bits.
    let mut hbytes = [0 as u8; 32];
    hbytes[0] = 0 + (1 << 4);
    hbytes[1] = 2 + (3 << 4);
    hbytes[2] = 4 + (5 << 4);
    hbytes[3] = 6 + (7 << 4);
    hbytes[4] = 8 + (9 << 4);
    hbytes[5] = 10 + (11 << 4);
    hbytes[6] = 12 + (13 << 4);
    hbytes[7] = 14 + (15 << 4);
    let hash = Hash::new(&hbytes);

    // check that we can recover these sequential numbers.
    for i in 0..16 {
        assert_eq!(i as u8, hash_prefix(i*BIT_DEPTH, hash));
    }
}

#[test]
fn hash_prefix_produces_expected_indexes() {
    let hash = match "J46VKteiMLz35gHZyaP5G7DsmcFjhYpDS6XZ3DVhppEn".parse::<Hash>() {
        Ok(h) => h,
        Err(_err) => panic!("could not create hash")
    };
    assert_eq!(13 as u8, hash_prefix(0, hash));
    assert_eq!(15 as u8, hash_prefix(4, hash));
    assert_eq!(1 as u8, hash_prefix(8, hash));
    assert_eq!(6 as u8, hash_prefix(12, hash));
    assert_eq!(0 as u8, hash_prefix(16, hash));
    assert_eq!(10 as u8, hash_prefix(20, hash));
}