/**
 * Crea los usuarios del sistema en Firebase Auth + Firestore.
 * Ejecutar: GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json node scripts/seed-users.mjs
 *
 * Lógica de login (sin email visible):
 *   Admin       → polar2024        → admin@polarbreeze.com
 *   Despachador → despacho2024     → despachador@polarbreeze.com
 *   Chofer      → su ficha (ej: 0042) → 0042@chofer.polarbreeze.com
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({ credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) });
}

const adminAuth = getAuth();
const adminDb = getFirestore();

const users = [
  {
    email: "admin@polarbreeze.com",
    password: "polar2024",
    nombre: "Administrador",
    role: "admin",
  },
  {
    email: "despachador@polarbreeze.com",
    password: "despacho2024",
    nombre: "Despachador Principal",
    role: "despachador",
  },
  // Choferes: agrega tantos como necesites.
  // El email es: {ficha}@chofer.polarbreeze.com
  // La contraseña ES la ficha.
  { ficha: "0001", nombre: "Chofer 1" },
  { ficha: "0002", nombre: "Chofer 2" },
  { ficha: "0003", nombre: "Chofer 3" },
];

for (const u of users) {
  const isChofer = "ficha" in u;
  const email = isChofer ? `${u.ficha}@chofer.polarbreeze.com` : u.email;
  const password = isChofer ? u.ficha : u.password;
  const nombre = u.nombre;
  const role = isChofer ? "chofer" : u.role;

  try {
    const record = await adminAuth.createUser({ email, password, displayName: nombre });
    await adminDb.collection("usuarios").doc(record.uid).set({
      uid: record.uid,
      email,
      nombre,
      role,
      ...(isChofer && { ficha: u.ficha }),
      createdAt: new Date(),
    });
    console.log(`✓ ${role.padEnd(12)} ${email}`);
  } catch (e) {
    console.log(`⚠  ${email}: ${e.message}`);
  }
}

console.log("\n✅ Usuarios listos.\n");
console.log("  Admin:       polar2024");
console.log("  Despachador: despacho2024");
console.log("  Chofer:      su número de ficha (ej: 0001)");
