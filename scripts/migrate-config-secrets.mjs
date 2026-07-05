#!/usr/bin/env node
/**
 * migrate-config-secrets.mjs
 * Migración de una sola vez para el fix S1 (2026-07-05): mueve los campos
 * sensibles de config/main (legible hoy por CUALQUIER rol autenticado, por la
 * regla `match /config/{doc} { allow read: if request.auth != null }`) a un
 * documento nuevo config/secrets (solo-admin en las reglas nuevas).
 *
 * Campos que se mueven: resetPassword, telegramToken, telegramChatId,
 * correoMonitoreo, correoPassword.
 *
 * Seguridad: este script NUNCA imprime los valores reales, solo los nombres
 * de los campos y si existían o no.
 *
 * Por defecto es DRY-RUN (no escribe nada). Para ejecutar de verdad: --yes
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json \
 *     node scripts/migrate-config-secrets.mjs            # dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json \
 *     node scripts/migrate-config-secrets.mjs --yes      # ejecuta de verdad
 *
 * Idempotente: si un campo ya no está en config/main (porque ya se migró),
 * simplemente se omite. Correrlo dos veces es seguro.
 */
import admin from "firebase-admin";
import { readFileSync } from "node:fs";

const SECRET_FIELDS = [
  "resetPassword",
  "telegramToken",
  "telegramChatId",
  "correoMonitoreo",
  "correoPassword",
];

const dryRun = !process.argv.includes("--yes");

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error("Define GOOGLE_APPLICATION_CREDENTIALS apuntando al service account JSON.");
  }
  const credentials = JSON.parse(readFileSync(credPath, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(credentials) });
}

async function main() {
  initAdmin();
  const db = admin.firestore();

  const mainRef = db.collection("config").doc("main");
  const mainSnap = await mainRef.get();
  if (!mainSnap.exists) {
    console.log("config/main no existe. Nada que migrar.");
    return;
  }
  const mainData = mainSnap.data();

  const toMigrate = {};
  const deleteUpdate = {};
  for (const field of SECRET_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(mainData, field);
    console.log(`  ${field}: ${present ? "presente en config/main -> se migra" : "no presente (se omite)"}`);
    if (present) {
      toMigrate[field] = mainData[field];
      deleteUpdate[field] = admin.firestore.FieldValue.delete();
    }
  }

  const count = Object.keys(toMigrate).length;
  if (count === 0) {
    console.log("\nNada que migrar (ya está limpio o nunca existieron esos campos).");
    return;
  }

  console.log(`\n${dryRun ? "[DRY-RUN] " : ""}Se migrarían ${count} campo(s) a config/secrets, y se borrarían de config/main.`);
  if (dryRun) {
    console.log("Nada se escribió de verdad. Agrega --yes para ejecutar.");
    return;
  }

  await db.collection("config").doc("secrets").set(toMigrate, { merge: true });
  await mainRef.update(deleteUpdate);

  console.log(`OK — ${count} campo(s) migrado(s) a config/secrets y borrados de config/main.`);
}

main().catch((err) => {
  console.error("Migración falló:", err.message);
  process.exit(1);
});
