const crypto = require('crypto');

// ============================================
// UTILIDADES PARA GENERACIÓN DE DIDs
// ============================================

/**
 * Genera un DID de Polygon ID desde una dirección Ethereum
 * Basado en el estándar Polygon ID para mainnet/testnet
 */
function didFromEthAddress(ethAddress, environment = 'testnet') {
    const configs = {
        testnet: {
            method: 'polygonid',
            network: 'polygon',
            subnet: 'amoy',
            idTypeHex: '0213'
        },
        mainnet: {
            method: 'polygonid',
            network: 'polygon',
            subnet: 'main',
            idTypeHex: '0212'
        }
    };

    const config = configs[environment];
    const addrHex = ethAddress.toLowerCase().replace(/^0x/, '');
    
    if (addrHex.length !== 40) {
        throw new Error('Dirección EVM inválida');
    }

    const idType = Buffer.from(config.idTypeHex, 'hex');
    const zeroPad = Buffer.alloc(7, 0);
    const addr = Buffer.from(addrHex, 'hex');
    const body = Buffer.concat([idType, zeroPad, addr]);

    // Checksum uint16 (overflow), little-endian
    const sum = body.reduce((a, b) => (a + b) & 0xffff, 0);
    const checksum = Buffer.from([sum & 0xff, sum >> 8]);

    // Base58 encoding (para producción usar librería bs58)
    const idBytes = Buffer.concat([body, checksum]);
    const idBase58 = idBytes.toString('base64').replace(/[+/=]/g, '');

    return `did:${config.method}:${config.network}:${config.subnet}:${idBase58}`;
}

// ============================================
// ESQUEMAS PARA IDENTIDAD (DID)
// ============================================

/**
 * Transforma datos de usuario del frontend al formato del issuer node
 * Este es el schema para CREAR la identidad (DID)
 */
const userToIdentitySchema = (userData) => {
    return {
        didMetadata: {
            method: "polygonid",
            blockchain: "polygon",
            network: "amoy" // o "main" para producción
        },
        userData: {
            name: userData.name,
            email: userData.email,
            state: userData.state || "active",
            registeredAt: new Date().toISOString()
        }
    };
};

/**
 * Schema para crear identidad desde wallet address
 */
const walletToIdentitySchema = (walletAddress, userData = {}) => {
    return {
        didMetadata: {
            method: "polygonid",
            blockchain: "polygon",
            network: "amoy",
            walletAddress: walletAddress
        },
        userData: {
            name: userData.name || `Wallet User`,
            walletAddress: walletAddress,
            authMethod: 'wallet',
            state: userData.state || "active",
            registeredAt: new Date().toISOString()
        }
    };
};

// ============================================
// ESQUEMAS PARA CREDENCIALES VERIFICABLES (VC)
// ============================================

/**
 * Crea una Credencial Verificable (VC) para autenticación de usuario
 * Este schema se usa DESPUÉS de crear el DID
 */
const createUserAuthCredential = (did, userData) => {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const expirationTimestamp = currentTimestamp + (365 * 24 * 60 * 60); // 1 año

    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v2",
            "https://schema.iden3.io/core/jsonld/iden3proofs.jsonld",
            "ipfs://QmUserAuthCredentialContext"
        ],
        "type": ["VerifiableCredential", "UserAuthCredential"],
        "credentialSubject": {
            id: did,
            fullName: userData.name,
            email: userData.email || null,
            walletAddress: userData.walletAddress || null,
            authMethod: userData.authMethod || 'email',
            accountState: userData.state || 'active',
            registrationDate: currentTimestamp,
            isVerified: userData.isVerified || false
        },
        "credentialSchema": {
            "id": "ipfs://QmUserAuthCredentialSchema",
            "type": "JsonSchemaValidator2018"
        },
        "issuanceDate": new Date().toISOString(),
        "expirationDate": new Date(expirationTimestamp * 1000).toISOString()
    };
};

/**
 * Crea una VC específica para wallet authentication
 */
const createWalletAuthCredential = (did, walletAddress, userData = {}) => {
    const currentTimestamp = Math.floor(Date.now() / 1000);

    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://schema.iden3.io/core/jsonld/iden3proofs.jsonld",
            "ipfs://QmWalletAuthContext"
        ],
        "type": ["VerifiableCredential", "WalletAuthCredential"],
        "credentialSubject": {
            id: did,
            walletAddress: walletAddress,
            fullName: userData.name || `Wallet ${walletAddress.slice(0, 6)}...`,
            authMethod: 'wallet',
            accountState: 'active',
            registrationDate: currentTimestamp,
            isVerified: true // Wallet connections son verificadas por firma
        },
        "credentialSchema": {
            "id": "ipfs://QmWalletAuthSchema",
            "type": "JsonSchemaValidator2018"
        },
        "issuanceDate": new Date().toISOString()
    };
};

/**
 * Schema genérico para credencial verificable (compatible con W3C)
 */
const createVerifiableCredentialSchema = (did, userData) => {
    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://schema.iden3.io/core/jsonld/iden3proofs.jsonld"
        ],
        "type": ["VerifiableCredential", "UserCredential"],
        "credentialSubject": {
            id: did,
            name: userData.name,
            email: userData.email,
            state: userData.state || "active",
            issuedAt: new Date().toISOString()
        },
        "credentialSchema": {
            "id": "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json-ld/kyc-v3.json-ld",
            "type": "JsonSchemaValidator2018"
        }
    };
};

// ============================================
// FORMATO DE RESPUESTAS
// ============================================

/**
 * Formatea la respuesta del issuer node para el frontend
 * Incluye DID, credenciales y datos ZKP
 */
const formatResponseForFrontend = (issuerResponse, userData) => {
    const did = issuerResponse.identifier || issuerResponse.did;
    
    return {
        success: true,
        did: did,
        user: {
            name: userData.name,
            email: userData.email || null,
            walletAddress: userData.walletAddress || null,
            type: userData.walletAddress ? 'wallet' : 'zkp',
            state: userData.state || 'active'
        },
        zkpData: {
            identifier: did,
            state: issuerResponse.state,
            // Información para generar proofs ZKP
            proofData: {
                issuerDid: did,
                schema: issuerResponse.schema || null,
                claimData: issuerResponse.claims || null,
                credentialSubject: {
                    name: userData.name,
                    email: userData.email,
                    walletAddress: userData.walletAddress
                }
            },
            // Credenciales emitidas
            credentials: issuerResponse.credentials || []
        },
        timestamp: new Date().toISOString()
    };
};

/**
 * Formatea respuesta para login (obtiene DID existente)
 */
const formatLoginResponse = (issuerResponse, userData) => {
    return {
        success: true,
        did: issuerResponse.identifier || issuerResponse.did,
        user: {
            name: userData.name,
            email: userData.email,
            type: userData.authMethod || 'zkp'
        },
        zkpData: issuerResponse.zkpData || null,
        message: 'Login exitoso'
    };
};

module.exports = {
    // Utilidades DID
    didFromEthAddress,
    
    // Schemas para Identity (DID)
    userToIdentitySchema,
    walletToIdentitySchema,
    
    // Schemas para Credenciales Verificables (VC)
    createUserAuthCredential,
    createWalletAuthCredential,
    createVerifiableCredentialSchema,
    
    // Formateo de respuestas
    formatResponseForFrontend,
    formatLoginResponse
}; 