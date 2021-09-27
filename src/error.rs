use thiserror::Error;

use solana_program::program_error::ProgramError;

#[derive(Error, Debug, Copy, Clone)]
pub enum HAMTError {
    /// Invalid instruction
    #[error("Invalid Instruction")]
    InvalidInstruction,
    #[error("Not Rent Exempt")]
    NotRentExempt,
}

impl From<HAMTError> for ProgramError {
    fn from(e: HAMTError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
