/**
 * ZKP PROOFS - Generación y Verificación
 * 
 * Tipos de pruebas soportadas por Privado ID:
 * 1. Atomic Query Sig V2 (BJJ Signature)
 * 2. Atomic Query MTP V2 (Merkle Tree Proof) ← Usado por default
 */

/**
 * Esquema de request para generar prueba ZKP
 * Atomic Query MTP V2 - Merkle Tree Proof
 */
function createZKPProofRequest(credentialId, claimQuery) {
    return {
        circuitId: "credentialAtomicQueryMTPV2", // MTP V2 por defecto
        credentialId: credentialId,
        query: {
            allowedIssuers: ["*"], // O especificar DIDs del issuer
            context: "ipfs://QmXAHpXSPcj2J7wreCkKkvvXgT67tbQDvFxmTHudXQYBEp",
            type: "ZKPAuthCredential",
            credentialSubject: claimQuery // Qué campo probar
        }
    };
}

/**
 * Crear query para probar edad mayor que X
 * Ejemplo: Probar que el usuario es mayor de 18
 */
function createAgeQuery(minAge) {
    return {
        registrationDate: {
            $lt: Math.floor(Date.now() / 1000) - (minAge * 365 * 24 * 60 * 60)
        }
    };
}

/**
 * Crear query para probar estado de cuenta
 * Ejemplo: Probar que la cuenta está activa
 */
function createAccountStateQuery(state = "active") {
    return {
        accountState: {
            $eq: state
        }
    };
}

/**
 * Crear query para probar verificación
 * Ejemplo: Probar que está verificado sin revelar otros datos
 */
function createVerificationQuery(isVerified = true) {
    return {
        isVerified: {
            $eq: isVerified
        }
    };
}

/**
 * Crear query para probar método de autenticación
 * Ejemplo: Probar que usó wallet sin revelar la dirección
 */
function createAuthMethodQuery(method = "wallet") {
    return {
        authMethod: {
            $eq: method
        }
    };
}

/**
 * Crear query para probar usuario registrado por email
 * Ejemplo: Probar que se registró con email sin revelar el email
 */
function createEmailRegistrationQuery() {
    return {
        email: {
            $exists: true
        },
        authMethod: {
            $eq: "email"
        }
    };
}

/**
 * Crear query para probar usuario registrado por wallet
 * Ejemplo: Probar que se registró con wallet sin revelar la dirección
 */
function createWalletRegistrationQuery() {
    return {
        walletAddress: {
            $exists: true
        },
        authMethod: {
            $eq: "wallet"
        }
    };
}

/**
 * Crear query para probar antigüedad de la cuenta
 * Ejemplo: Probar que la cuenta tiene más de X días
 */
function createAccountAgeQuery(minDays) {
    const minTimestamp = Math.floor(Date.now() / 1000) - (minDays * 24 * 60 * 60);
    return {
        registrationDate: {
            $lt: minTimestamp
        }
    };
}

/**
 * Crear query para probar rango de fechas de registro
 * Ejemplo: Probar que se registró entre dos fechas
 */
function createRegistrationDateRangeQuery(startDate, endDate) {
    return {
        registrationDate: {
            $gt: Math.floor(startDate.getTime() / 1000),
            $lt: Math.floor(endDate.getTime() / 1000)
        }
    };
}

/**
 * Crear query combinado completo
 * Ejemplo: Probar múltiples condiciones a la vez
 */
function createCombinedQuery(conditions) {
    const query = {};
    
    if (conditions.isVerified !== undefined) {
        query.isVerified = { $eq: conditions.isVerified };
    }
    
    if (conditions.accountState) {
        query.accountState = { $eq: conditions.accountState };
    }
    
    if (conditions.authMethod) {
        query.authMethod = { $eq: conditions.authMethod };
    }
    
    if (conditions.minAge) {
        const minTimestamp = Math.floor(Date.now() / 1000) - (conditions.minAge * 24 * 60 * 60);
        query.registrationDate = { $lt: minTimestamp };
    }
    
    if (conditions.hasEmail) {
        query.email = { $exists: true };
    }
    
    if (conditions.hasWallet) {
        query.walletAddress = { $exists: true };
    }
    
    return query;
}

/**
 * Operadores disponibles para queries:
 * $eq: Igual a
 * $ne: No igual a
 * $lt: Menor que
 * $gt: Mayor que
 * $in: En lista
 * $nin: No en lista
 * $exists: Existe el campo
 */

/**
 * Crear proof request completo para el Issuer Node
 */
function createFullProofRequest(userDID, issuerDID, credentialId, proofType = "MTP") {
    const circuitId = proofType === "MTP" 
        ? "credentialAtomicQueryMTPV2"
        : "credentialAtomicQuerySigV2";

    return {
        circuitId: circuitId,
        accountAddress: userDID,
        query: {
            allowedIssuers: [issuerDID],
            context: "ipfs://QmXAHpXSPcj2J7wreCkKkvvXgT67tbQDvFxmTHudXQYBEp",
            credentialSubject: {
                isVerified: { $eq: true },
                accountState: { $eq: "active" },
                authMethod: { $eq: "wallet" }
            },
            type: "ZKPAuthCredential"
        }
    };
}

/**
 * Formato de respuesta de prueba ZKP
 */
function formatZKPProofResponse(proofData) {
    return {
        proof: {
            pi_a: proofData.pi_a,
            pi_b: proofData.pi_b,
            pi_c: proofData.pi_c,
            protocol: "groth16",
            curve: "bn128"
        },
        pub_signals: proofData.pub_signals,
        circuitId: proofData.circuitId,
        timestamp: new Date().toISOString()
    };
}

/**
 * 1. Usuario tiene credencial con:
 *    - isVerified: true
 *    - accountState: "active"
 *    - authMethod: "wallet"
 * 
 * 2. Quiere probar que está verificado SIN revelar otros datos
 * 
 * 3. Genera prueba ZKP:
 *    const query = createVerificationQuery();
 *    const proofRequest = createZKPProofRequest(credentialId, query);
 * 
 * 4. El Issuer Node genera la prueba
 * 
 * 5. El verificador valida la prueba sin ver los datos originales
 */

module.exports = {
    // Crear proof requests
    createZKPProofRequest,
    createFullProofRequest,
    
    // Queries predefinidos básicos
    createAgeQuery,
    createAccountStateQuery,
    createVerificationQuery,
    createAuthMethodQuery,
    
    // Queries para tipos de registro
    createEmailRegistrationQuery,
    createWalletRegistrationQuery,
    
    // Queries avanzados
    createAccountAgeQuery,
    createRegistrationDateRangeQuery,
    createCombinedQuery,
    
    // Formateo
    formatZKPProofResponse
};
