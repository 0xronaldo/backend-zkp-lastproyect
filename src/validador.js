/**
 * VALIDADOR - Validaciones básicas
 * 
 * Por qué crypto y no ethers:
 * - crypto: Nativo de Node.js, para hashing (SHA256)
 * - ethers: Para blockchain (firmas, transacciones, smart contracts)
 * 
 * Aquí solo hasheamos datos, no firmamos transacciones.
 * El Issuer Node hace las firmas criptográficas ZKP.
 */

const crypto = require('crypto');

function hashData(data) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(data))
        .digest('hex');
}

function validateTimestamp(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 365 * 24 * 60 * 60; // 1 año
    
    if (timestamp > now) {
        return { valid: false, reason: 'Timestamp futuro' };
    }
    
    if (now - timestamp > maxAge) {
        return { valid: false, reason: 'Timestamp muy antiguo' };
    }
    
    return { valid: true };
}

function validateDID(did) {
    const didPattern = /^did:polygonid:polygon:(amoy|main):.+$/;
    return didPattern.test(did);
}

function validateWalletAddress(address) {
    const addressPattern = /^0x[a-fA-F0-9]{40}$/;
    return addressPattern.test(address);
}

function validateEmail(email) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
}

module.exports = {
    hashData,
    validateTimestamp,
    validateDID,
    validateWalletAddress,
    validateEmail
};
