/**
 * Verificador ZKP - Usa el Issuer Node para verificación real
 * 
 * En lugar de usar el SDK completo (que es complejo),
 * usamos el API del Issuer Node para verificar credenciales
 */

const axios = require('axios');

/**
 * Verifica una credencial contra el Issuer Node
 * @param {Object} credential - Credencial W3C a verificar
 * @param {string} issuerDID - DID del emisor
 * @param {string} issuerNodeUrl - URL del Issuer Node
 * @param {Object} auth - Credenciales de autenticación
 * @returns {Promise<Object>} - Resultado de la verificación
 */
async function verifyCredentialWithIssuer(credential, issuerDID, issuerNodeUrl, auth) {
    try {
        console.log('[ZKP-Verifier] 🔍 Verificando credencial...');
        console.log('[ZKP-Verifier] Credential ID:', credential.id);
        console.log('[ZKP-Verifier] Issuer DID:', issuerDID);

        // 1. Validar estructura básica
        const structureValid = validateCredentialStructure(credential);
        if (!structureValid.valid) {
            return {
                verified: false,
                error: structureValid.error,
                stage: 'structure_validation'
            };
        }

        // 2. Verificar que la credencial existe en el Issuer Node
        try {
            const credentialId = credential.id.replace('urn:uuid:', '');
            
            console.log('[ZKP-Verifier] Consultando Issuer Node...');
            const response = await axios.get(
                `${issuerNodeUrl}/v2/identities/${issuerDID}/credentials/${credentialId}`,
                {
                    auth: auth,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 5000
                }
            );

            console.log('[ZKP-Verifier] ✅ Credencial encontrada en Issuer Node');
            
            // 3. Verificar que no esté revocada
            if (response.data.revoked) {
                return {
                    verified: false,
                    error: 'Credencial revocada',
                    stage: 'revocation_check',
                    details: response.data
                };
            }

            // 4. Verificar que los datos coincidan
            const dataValid = compareCredentialData(credential, response.data.vc);
            if (!dataValid.valid) {
                return {
                    verified: false,
                    error: dataValid.error,
                    stage: 'data_comparison'
                };
            }

            // 5. TODO: Aquí se podría verificar la firma criptográfica del proof
            // Por ahora, si llegamos aquí, la credencial es válida
            
            // Extraer información del proof criptográfico
            const proofInfo = extractProofInfo(response.data);
            
            console.log('[ZKP-Verifier] ✅ Credencial VERIFICADA correctamente');
            console.log('[ZKP-Verifier] 📊 Proof Info:', proofInfo);
            
            return {
                verified: true,
                message: 'Credencial verificada exitosamente',
                details: {
                    credentialId: credentialId,
                    issuer: issuerDID,
                    subject: credential.credentialSubject.id,
                    issuanceDate: credential.issuanceDate,
                    notRevoked: !response.data.revoked,
                    proofTypes: response.data.proofTypes || [],
                    // Información completa del proof ZKP
                    zkpProof: proofInfo
                },
                // Raw data completo para mostrar en JSON
                rawData: {
                    credential: response.data,
                    verification: {
                        timestamp: new Date().toISOString(),
                        method: 'issuer-node-verification',
                        structureValid: true,
                        revocationChecked: true,
                        dataComparison: true
                    }
                }
            };

        } catch (issuerError) {
            console.error('[ZKP-Verifier] ❌ No se pudo verificar con Issuer Node:', issuerError.message);
            console.error('[ZKP-Verifier] ❌ Detalles del error:', issuerError.response?.data || issuerError);
            
            // NO usar verificación local - debe fallar si Issuer Node no responde
            return {
                verified: false,
                error: `No se pudo verificar con Issuer Node: ${issuerError.message}`,
                stage: 'issuer_node_connection',
                details: {
                    issuerNodeUrl: issuerNodeUrl,
                    issuerDID: issuerDID,
                    errorDetails: issuerError.response?.data || issuerError.message
                }
            };
        }

    } catch (error) {
        console.error('[ZKP-Verifier] ❌ Error en verificación:', error.message);
        return {
            verified: false,
            error: error.message,
            stage: 'general_error'
        };
    }
}

/**
 * Valida la estructura básica de una credencial W3C
 */
function validateCredentialStructure(credential) {
    if (!credential) {
        return { valid: false, error: 'Credencial vacía' };
    }

    // Campos requeridos por W3C
    const requiredFields = ['id', 'type', 'issuer', 'issuanceDate', 'credentialSubject'];
    
    for (const field of requiredFields) {
        if (!credential[field]) {
            return { 
                valid: false, 
                error: `Campo requerido faltante: ${field}` 
            };
        }
    }

    // Validar tipo
    if (!Array.isArray(credential.type) || !credential.type.includes('VerifiableCredential')) {
        return { 
            valid: false, 
            error: 'Tipo de credencial inválido (debe incluir VerifiableCredential)' 
        };
    }

    // Validar credentialSubject
    if (!credential.credentialSubject.id) {
        return { 
            valid: false, 
            error: 'credentialSubject.id es requerido' 
        };
    }

    return { valid: true };
}

/**
 * Compara los datos de la credencial local con los del Issuer Node
 */
function compareCredentialData(localCred, issuerCred) {
    try {
        // Comparar campos críticos
        if (localCred.id !== issuerCred.id) {
            return { 
                valid: false, 
                error: 'ID de credencial no coincide' 
            };
        }

        if (localCred.issuer !== issuerCred.issuer) {
            return { 
                valid: false, 
                error: 'Issuer no coincide' 
            };
        }

        if (localCred.credentialSubject.id !== issuerCred.credentialSubject.id) {
            return { 
                valid: false, 
                error: 'Subject ID no coincide' 
            };
        }

        return { valid: true };
    } catch (error) {
        return { 
            valid: false, 
            error: `Error comparando datos: ${error.message}` 
        };
    }
}

/**
 * Extrae información detallada del proof criptográfico
 */
function extractProofInfo(credentialData) {
    const proofInfo = {
        types: credentialData.proofTypes || [],
        proofs: []
    };

    if (credentialData.vc && credentialData.vc.proof) {
        const proofs = Array.isArray(credentialData.vc.proof) 
            ? credentialData.vc.proof 
            : [credentialData.vc.proof];

        proofs.forEach(proof => {
            const proofData = {
                type: proof.type,
                signature: proof.signature ? proof.signature.substring(0, 20) + '...' : null,
                coreClaim: proof.coreClaim ? proof.coreClaim.substring(0, 40) + '...' : null,
                issuerData: null
            };

            if (proof.issuerData) {
                proofData.issuerData = {
                    id: proof.issuerData.id,
                    state: {
                        value: proof.issuerData.state?.value?.substring(0, 20) + '...' || null,
                        claimsTreeRoot: proof.issuerData.state?.claimsTreeRoot?.substring(0, 20) + '...' || null
                    },
                    authCoreClaim: proof.issuerData.authCoreClaim ? 
                        proof.issuerData.authCoreClaim.substring(0, 40) + '...' : null,
                    mtp: {
                        existence: proof.issuerData.mtp?.existence,
                        siblingsCount: proof.issuerData.mtp?.siblings?.length || 0
                    }
                };
            }

            proofInfo.proofs.push(proofData);
        });
    }

    return proofInfo;
}

/**
 * Genera un proof request para ZKP (simulado)
 * En producción, esto usaría el SDK completo
 */
function generateProofRequest(credential, query) {
    return {
        id: Math.floor(Math.random() * 1000000),
        circuitId: 'credentialAtomicQueryMTPV2',
        query: {
            allowedIssuers: [credential.issuer],
            type: credential.type[1] || 'ZKPAuthCredential',
            context: credential['@context'][credential['@context'].length - 1],
            credentialSubject: query || {}
        }
    };
}

module.exports = {
    verifyCredentialWithIssuer,
    validateCredentialStructure,
    generateProofRequest
};
