//! Anchor-compatible event logs: `sol_log_data(disc || borsh(fields))`, which
//! explorers and indexers render as `Program data: <base64>`.

use pinocchio::pubkey::Pubkey;

pub mod discriminator {
    pub const CONFIG_INITIALIZED: [u8; 8] = [181, 49, 200, 156, 19, 167, 178, 91];
    pub const PAUSE_CHANGED: [u8; 8] = [238, 188, 213, 78, 134, 209, 178, 218];
    pub const PAUSE_AUTHORITY_CHANGED: [u8; 8] = [189, 140, 155, 68, 40, 110, 29, 128];
    pub const GROUP_CREATED: [u8; 8] = [132, 94, 184, 198, 77, 165, 13, 26];
    pub const MEMBER_INVITED: [u8; 8] = [160, 10, 224, 200, 65, 165, 172, 75];
    pub const MEMBER_JOINED: [u8; 8] = [156, 199, 149, 88, 193, 203, 191, 210];
    pub const SECRET_REVEALED: [u8; 8] = [164, 226, 145, 231, 240, 31, 44, 142];
    pub const ORDER_FINALIZED: [u8; 8] = [108, 182, 113, 19, 131, 132, 255, 94];
    pub const COLLATERAL_POSTED: [u8; 8] = [133, 193, 58, 199, 229, 183, 154, 206];
    pub const GROUP_ACTIVATED: [u8; 8] = [81, 35, 168, 18, 82, 161, 51, 234];
    pub const CONTRIBUTION_RECORDED: [u8; 8] = [203, 113, 176, 23, 205, 17, 184, 101];
    pub const DEFAULT_COVERED: [u8; 8] = [106, 229, 254, 192, 25, 69, 26, 132];
    pub const ROUND_SETTLED: [u8; 8] = [249, 225, 66, 54, 157, 200, 234, 222];
    pub const GROUP_TERMINATED: [u8; 8] = [54, 255, 43, 103, 189, 36, 56, 67];
    pub const FAILED_ROUND_REFUNDED: [u8; 8] = [245, 48, 191, 176, 111, 87, 180, 184];
    pub const COLLATERAL_REFUNDED: [u8; 8] = [61, 61, 254, 24, 36, 237, 169, 51];
}

/// Fixed-size buffer; the largest event (`RoundSettled`) is 115 bytes.
pub struct Event {
    buf: [u8; 128],
    len: usize,
}

impl Event {
    #[inline(always)]
    pub fn new(discriminator: [u8; 8]) -> Self {
        let mut buf = [0u8; 128];
        buf[..8].copy_from_slice(&discriminator);
        Self { buf, len: 8 }
    }

    #[inline(never)]
    fn bytes(&mut self, bytes: &[u8]) -> &mut Self {
        // Every event fits the buffer; anything past it would be dropped, not panic.
        for (slot, byte) in self.buf.iter_mut().skip(self.len).zip(bytes) {
            *slot = *byte;
            self.len += 1;
        }
        self
    }

    pub fn key(&mut self, key: &Pubkey) -> &mut Self {
        self.bytes(key)
    }

    pub fn hash(&mut self, hash: &[u8; 32]) -> &mut Self {
        self.bytes(hash)
    }

    pub fn u8(&mut self, value: u8) -> &mut Self {
        self.bytes(&[value])
    }

    pub fn bool(&mut self, value: bool) -> &mut Self {
        self.bytes(&[value as u8])
    }

    pub fn u16(&mut self, value: u16) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    pub fn u64(&mut self, value: u64) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    pub fn i64(&mut self, value: i64) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    #[inline(never)]
    pub fn emit(&mut self) {
        #[cfg(all(target_os = "solana", not(feature = "no-events")))]
        pinocchio::log::sol_log_data(&[self.buf.get(..self.len).unwrap_or(&self.buf)]);
        #[cfg(not(all(target_os = "solana", not(feature = "no-events"))))]
        let _ = self.len;
    }
}
