use solana_program::program_error::ProgramError;

use borsh::{BorshDeserialize, BorshSerialize};

pub trait Serdes: Sized + BorshSerialize + BorshDeserialize {
	fn pack(&self, dst: &mut [u8]) {
		let encoded = self.try_to_vec().unwrap();
		dst[..encoded.len()].copy_from_slice(&encoded);
	}
	fn unpack(src: &[u8]) -> Result<Self, ProgramError> {
		Self::try_from_slice(src).map_err(|_| ProgramError::InvalidAccountData)
	}
}
