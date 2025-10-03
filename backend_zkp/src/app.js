// configuracion iniciales 

// preparacion del backend para escucha del frontend 
// en otra pagina se prepara la escucha de cada solicitud 


const express = require ('express'); // manejar las solicitudes http
const cors = require ('cors');
const dotenv = require ('dotenv');
const routes = require ('../rutas/routes');

dotenv.config();

// direccion de raiz invoca a express
const riz = express();

riz.use(cors()); //habilitar el escucha de las  solicitudes

riz.use(express.json()); // parser del json
// rutas
riz.use('/', routes);
// Ruta de prueba
riz.get('/health', (req, res) => {
  res.json({ message: 'Backend ZKP funcionando correctamente' });
}); 



// trabaja con el .env archivo de configuracion
// levanta el servidor
const PORT = process.env.PORT || 5000;
riz.listen(PORT, () => {
  console.log(`Servidor : http://localhost:${PORT}`);
});

