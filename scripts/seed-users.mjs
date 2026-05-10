/**
 * Crea los usuarios iniciales en Firebase Auth + Firestore.
 * Ejecutar UNA sola vez: node scripts/seed-users.mjs
 *
 * Requiere: npm install firebase-admin
 * Y configurar la variable de entorno GOOGLE_APPLICATION_CREDENTIALS
 * apuntando al serviceAccountKey.json de Firebase.
 *
 * Usuarios creados:
 *   admin@polarbreeze.com      / Admin2024!   → rol: admin
 *   despachador@polarbreeze.com/ Desp2024!    → rol: despachador
 *   chofer@polarbreeze.com     / Chofer2024!  → rol: chofer
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
  { email: "admin@polarbreeze.com", password: "Admin2024!", nombre: "Administrador", role: "admin" },
  { email: "despachador@polarbreeze.com", password: "Desp2024!", nombre: "Despachador Principal", role: "despachador" },
  { email: "chofer@polarbreeze.com", password: "Chofer2024!", nombre: "Chofer 1", role: "chofer" },
];

for (const u of users) {
  try {
    const record = await adminAuth.createUser({ email: u.email, password: u.password, displayName: u.nombre });
    await adminDb.collection("usuarios").doc(record.uid).set({
      uid: record.uid,
      email: u.email,
      nombre: u.nombre,
      role: u.role,
      createdAt: new Date(),
    });
    console.log(`✓ Creado: ${u.email} (${u.role})`);
  } catch (e) {
    console.log(`⚠ ${u.email}: ${e.message}`);
  }
}

console.log("\nListo. Usuarios disponibles para iniciar sesión.");
