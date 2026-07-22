/**
 * Install dependencies:
 *
 * npm install firebase-admin dotenv
 *
 * Create a .env file:
 *
 * FIREBASE_PROJECT_ID=your-project-id
 * FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
 * FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
 *
 * Run:
 *
 * node migrate-users-to-firebase.js
 */

require("dotenv").config();

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const requiredEnvironmentVariables = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];

for (const variableName of requiredEnvironmentVariables) {
  if (!process.env[variableName]) {
    throw new Error(`Missing environment variable: ${variableName}`);
  }
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth();

const users = [
  {
    uid: "3d32feb1-e6a0-4790-882c-08ae5be56415",
    email: "apple-review@emirozdis.tr",
    emailVerified: true,
    displayName: "Apple Test",
    passwordHash: Buffer.from(
      "$2b$12$4iRZ0gBGCPNN1FY8UWUiaueovoygh16ZniHRPjyKVdQaJnNZAVrgK",
      "utf8"
    ),
  },
  {
    uid: "a1ce1725-ec71-4a5d-ab9f-41b12c302a74",
    email: "sozverdefne@gmail.com",
    emailVerified: true,
    displayName: "Defne Sözver",
    passwordHash: Buffer.from(
      "$2b$12$KlIs2.AA02i03Y85NqXz7e6rlKLXBFlNNGl1cdt8gnp7yKXQ.hVry",
      "utf8"
    ),
  },
  {
    uid: "dce26d25-d314-4d5e-aa5d-59760e15c32e",
    email: "emir.ozdis@gmail.com",
    emailVerified: true,
    displayName: "Emir",
    passwordHash: Buffer.from(
      "$2b$12$bqB0lhngR/BQQG9d1enIVutJl8gzdS8mtAcydFe2QhfCl8tX0kbOK",
      "utf8"
    ),
  },
  {
    uid: "efa35953-6ba1-4cc1-b090-3ca8efd96562",
    email: "kullanimlik0@gmail.com",
    emailVerified: true,
    displayName: "Google Account",
    photoURL:
      "https://lh3.googleusercontent.com/a/ACg8ocI57XgPFnmUjO9W18DVOtcx8Tb5Kp7TZTq_ke4H8Vu2FhdBkoo=s96-c",
  },
  {
    uid: "f57b8f72-ab0f-4b1d-92f9-0edb9ac8948b",
    email: "meyracoban09@gmail.com",
    emailVerified: true,
    displayName: "Meyra",
  },
  {
    uid: "f6149f08-0526-4f9f-9112-829be4061cbd",
    email: "nehravcii@gmail.com",
    emailVerified: true,
    displayName: "Nehir",
    passwordHash: Buffer.from(
      "$2b$12$U6j7jtAzdgodhw5JSTgDQuGygP6YMgSHjvKw3G7.ki1vWGe7jNZf.",
      "utf8"
    ),
  },
];

async function checkForExistingUser(user) {
  try {
    const existingUser = await auth.getUser(user.uid);

    console.log(
      `Skipping ${user.email}: UID already exists with email ${
        existingUser.email || "(no email)"
      }`
    );

    return true;
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }
  }

  try {
    const existingUser = await auth.getUserByEmail(user.email);

    throw new Error(
      `Cannot import ${user.email}. The email already exists under Firebase UID ` +
        `${existingUser.uid}, but the source UID is ${user.uid}.`
    );
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      return false;
    }

    throw error;
  }
}

async function main() {
  console.log(`Checking ${users.length} users...`);

  const usersToImport = [];

  for (const user of users) {
    const alreadyExists = await checkForExistingUser(user);

    if (!alreadyExists) {
      usersToImport.push(user);
    }
  }

  if (usersToImport.length === 0) {
    console.log("No users need to be imported.");
    return;
  }

  console.log(`Importing ${usersToImport.length} users...`);

  const result = await auth.importUsers(usersToImport, {
    hash: {
      algorithm: "BCRYPT",
    },
  });

  console.log(`Successfully imported: ${result.successCount}`);
  console.log(`Failed imports: ${result.failureCount}`);

  for (const item of result.errors) {
    const failedUser = usersToImport[item.index];

    console.error(
      `Failed to import ${failedUser?.email || `user index ${item.index}`}:`,
      item.error.code,
      item.error.message
    );
  }

  if (result.failureCount > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("Migration completed successfully.");
}

main().catch((error) => {
  console.error("Migration failed:");
  console.error(error);
  process.exitCode = 1;
});