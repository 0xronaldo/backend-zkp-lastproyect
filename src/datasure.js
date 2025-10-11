/**
 * DATASURE - Estructura de datos para credenciales
 * Simple y directo
 */

function createCredentialRequest(did, userData) {
    return {
        credentialSchema: "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json-ld/auth.json-ld",
        type: "UserAuthCredential",
        credentialSubject: {
            id: did,
            fullName: userData.fullName,
            email: userData.email || undefined,
            walletAddress: userData.walletAddress || undefined,
            authMethod: userData.authMethod,
            accountState: userData.accountState || "active",
            registrationDate: Math.floor(Date.now() / 1000),
            isVerified: userData.isVerified || false
        },
        expiration: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    };
}

function validateUserData(userData) {
    const errors = [];
    
    if (!userData.fullName) errors.push('fullName es requerido');
    if (!userData.authMethod) errors.push('authMethod es requerido');
    
    const validAuthMethods = ['email', 'wallet', 'hybrid'];
    if (userData.authMethod && !validAuthMethods.includes(userData.authMethod)) {
        errors.push('authMethod debe ser: email, wallet o hybrid');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

module.exports = {
    createCredentialRequest,
    validateUserData
};
