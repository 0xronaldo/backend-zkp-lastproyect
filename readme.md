Como generar un did : 

curl -X POST http://localhost:3001/#post-/v2/identities \
-H "Content-Type: application/json" \
-d '{"userData": {"name": "Brayan", "email": "juan@example.com", "state": "activo" }}'
