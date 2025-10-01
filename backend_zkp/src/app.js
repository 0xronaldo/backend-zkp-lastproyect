// configuracion iniciales 



const express = require ('express');
const cors = require ('cors');
const dotenv = require ('dotenv');


dotenv = config();

// direccion de raiz invoca a express
const riz = express();

riz.use(cors()); //habilitar el escucha de las  solicitudes

riz.use(express.json()); // parser del json


// rutas 




  
// trabaja con el .env archivo de configuracion
// levanta el servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor : http://localhost:${PORT}`);
});

