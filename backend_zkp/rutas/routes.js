const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
dat_config = dotenv.config();
const { 
    userToIdentitySchema, 
    walletToIdentitySchema,
    createUserAuthCredential,
    createWalletAuthCredential,
    createVerifiableCredentialSchema, 
    formatResponseForFrontend,
    formatLoginResponse,
    didFromEthAddress
} = require('../scheme/scheme');


const router = express.Router();

// Configura la URL base ISSUER
const ISSUER_NODE_BASE_URL = process.env.ISSUER_NODE_BASE_URL; // Cambia el puerto/host según tu configuración

/**
 * End points
 */
router.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        // Validar datos recibidos
        if (!name || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan datos requeridos: name, email, password' 
            });
        }

        console.log('📝 Registro de usuario:', { name, email });

        // PASO 1: Transformar datos según schema para el issuer node
        const identityData = userToIdentitySchema({
            name,
            email,
            state: 'active'
        });

        console.log('🔄 Creando DID en issuer node...');

        // PASO 2: Crear DID en el issuer node
        const response = await axios.post(
            `${ISSUER_NODE_BASE_URL}/v2/identities`,
            identityData
        );

        const did = response.data.identifier || response.data.did;
        console.log('✅ DID creado:', did);

        // PASO 3: Crear credencial verificable
        const credential = createUserAuthCredential(did, {
            name,
            email,
            authMethod: 'email',
            state: 'active',
            isVerified: false
        });

        console.log('📄 Credencial generada para:', email);

        // PASO 4: Formatear respuesta para el frontend con datos ZKP
        const frontendResponse = formatResponseForFrontend(response.data, {
            name,
            email,
            state: 'active'
        });

        // Agregar la credencial a la respuesta
        frontendResponse.credential = credential;

        // Retornar datos al frontend incluyendo DID y datos ZKP
        res.json(frontendResponse);

    } catch (error) {
        console.error('❌ Error en registro:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Error al crear cuenta y DID', 
            details: error.response?.data || error.message 
        });
    }
});

/**
 * REGISTRO/LOGIN con Wallet
 * 1. Genera DID desde wallet address
 * 2. Crea credencial de wallet
 * 3. Retorna datos ZKP
 */
router.post('/api/wallet-auth', async (req, res) => {
    try {
        const { walletAddress, name, signature } = req.body;
        
        if (!walletAddress) {
            return res.status(400).json({ 
                success: false, 
                error: 'Falta wallet address' 
            });
        }

        console.log('🦊 Autenticación con wallet:', walletAddress);

        // PASO 1: Generar DID desde wallet address
        // El issuer node puede generar esto o lo hacemos localmente
        const did = didFromEthAddress(walletAddress, 'testnet');
        
        console.log('✅ DID generado desde wallet:', did);

        // PASO 2: Transformar datos para issuer node
        const identityData = walletToIdentitySchema(walletAddress, {
            name: name || `Wallet User`,
            state: 'active'
        });

        // PASO 3: Registrar en issuer node (o verificar si existe)
        let issuerResponse;
        try {
            issuerResponse = await axios.post(
                `${ISSUER_NODE_BASE_URL}/v2/identities`,
                identityData
            );
        } catch (error) {
            // Si ya existe, intentar obtenerlo
            if (error.response?.status === 409) {
                console.log('ℹ️  DID ya existe, procediendo con login...');
                issuerResponse = { data: { identifier: did, state: 'active' } };
            } else {
                throw error;
            }
        }

        // PASO 4: Crear credencial de wallet
        const credential = createWalletAuthCredential(did, walletAddress, {
            name: name || `Wallet User`
        });

        // PASO 5: Formatear respuesta
        const frontendResponse = formatResponseForFrontend(issuerResponse.data, {
            name: name || `Wallet ${walletAddress.slice(0, 6)}...`,
            walletAddress,
            state: 'active'
        });

        frontendResponse.credential = credential;

        res.json(frontendResponse);

    } catch (error) {
        console.error('❌ Error en wallet auth:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Error en autenticación de wallet', 
            details: error.response?.data || error.message 
        });
    }
});

/**
 * LOGIN con Email/Password
 * Verifica credenciales y obtiene DID existente
 */
router.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan credenciales' 
            });
        }

        console.log('🔐 Intento de login:', email);

        // AQUÍ DEBERÍAS:
        // 1. Verificar password en tu base de datos o sistema
        // 2. Obtener el DID asociado al email desde el issuer node
        // 3. Recuperar credenciales existentes

        // Por ahora simulamos una respuesta exitosa
        const mockResponse = formatLoginResponse({
            identifier: 'did:polygonid:polygon:amoy:2qExample123',
            state: 'active'
        }, {
            name: email.split('@')[0],
            email: email,
            authMethod: 'email'
        });

        res.json(mockResponse);

    } catch (error) {
        console.error('❌ Error en login:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Error al iniciar sesión', 
            details: error.message 
        });
    }
});

// ============================================
// ENDPOINTS DIRECTOS AL ISSUER NODE
// ============================================

/**
 * Endpoint directo para crear DID (passthrough)
 */
router.post('/v2/identities', async (req, res) => {
    try {
        const response = await axios.post(`${ISSUER_NODE_BASE_URL}/v2/identities`, req.body);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error al crear DID', 
            details: error.response?.data || error.message 
        });
    }
});

/**
 * Endpoint con autenticación básica
 */
router.post('/v2/identities-auth', async (req, res) => {
    try {
        const auth = {
            username: 'user-issuer',
            password: 'password-issuer'
        };
        const headers = {
            'accept': 'application/json',
            'content-type': 'application/json'
        };
        const response = await axios.post(
            `${ISSUER_NODE_BASE_URL}/v2/identities`,
            req.body,
            { auth, headers }
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error al crear DID', 
            details: error.response?.data || error.message 
        });
    }
});

module.exports = router;