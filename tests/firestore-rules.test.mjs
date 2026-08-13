// Rules unit tests for firestore.rules — specifically the access-control
// surface added for Mentor/Admin permissions (isAssignedMentor(), and the
// users/{userId} role/mentorId self-write protection). Run against the
// Firestore emulator (must already be running — see `firebase emulators:start`
// or the `thetradingworkshop-dev-emulated` dev server, both of which start it
// on the port below).
//
// This tests the RULES LOGIC itself, not the deployed app's specific named
// database — the same firestore.rules file is deployed to both (see
// firebase.json), and rule semantics don't depend on the database name, so
// testing against the emulator's default database is equivalent and simpler.
//
// Usage: node tests/firestore-rules.test.mjs
// (requires the Firestore emulator running on localhost:8085 — see firebase.json)

import { readFileSync } from 'fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';

// A comment payload matching isValidMentorComment(), with one field overridable per-test.
function commentPayload(overrides) {
  return {
    authorId: overrides.authorId,
    authorName: overrides.authorName ?? 'Someone',
    authorRole: overrides.authorRole,
    text: overrides.text ?? 'Nice trade management today.',
    createdAt: new Date(),
  };
}

const PROJECT_ID = 'rules-test-' + Date.now();

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message.split('\n')[0]}`);
    failed++;
  }
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8085,
    },
  });

  // --- Seed fixture data bypassing rules entirely ---
  const ADMIN_UID = 'admin-1';
  const MENTOR_UID = 'mentor-1';
  const OTHER_MENTOR_UID = 'mentor-2';
  const STUDENT_UID = 'student-1';       // assigned to MENTOR_UID
  const OTHER_STUDENT_UID = 'student-2'; // unassigned

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN_UID), { role: 'Admin', name: 'Admin One' });
    await setDoc(doc(db, 'users', MENTOR_UID), { role: 'Mentor', name: 'Mentor One' });
    await setDoc(doc(db, 'users', OTHER_MENTOR_UID), { role: 'Mentor', name: 'Mentor Two' });
    await setDoc(doc(db, 'users', STUDENT_UID), { role: 'Student', name: 'Student One', mentorId: MENTOR_UID });
    await setDoc(doc(db, 'users', OTHER_STUDENT_UID), { role: 'Student', name: 'Student Two' }); // no mentorId

    await setDoc(doc(db, 'trades', 'trade-1'), { userId: STUDENT_UID, symbol: 'ES' });
    await setDoc(doc(db, 'trades', 'trade-2'), { userId: OTHER_STUDENT_UID, symbol: 'NQ' });
    await setDoc(doc(db, 'journals', 'journal-1'), { userId: STUDENT_UID, title: 'Note' });
    await setDoc(doc(db, 'journals', 'journal-2'), { userId: OTHER_STUDENT_UID, title: 'Note' });
  });

  const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();
  const mentor = testEnv.authenticatedContext(MENTOR_UID).firestore();
  const otherMentor = testEnv.authenticatedContext(OTHER_MENTOR_UID).firestore();
  const student = testEnv.authenticatedContext(STUDENT_UID).firestore();
  const otherStudent = testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore();

  console.log('\ntrades — mentor scoping\n');

  await check('assigned mentor CAN read their student\'s trade', async () => {
    await assertSucceeds(getDoc(doc(mentor, 'trades', 'trade-1')));
  });

  await check('assigned mentor CANNOT read an unassigned student\'s trade', async () => {
    await assertFails(getDoc(doc(mentor, 'trades', 'trade-2')));
  });

  await check('a different mentor CANNOT read this student\'s trade', async () => {
    await assertFails(getDoc(doc(otherMentor, 'trades', 'trade-1')));
  });

  await check('assigned mentor CANNOT update the student\'s trade (read-only)', async () => {
    await assertFails(updateDoc(doc(mentor, 'trades', 'trade-1'), { symbol: 'CL' }));
  });

  await check('assigned mentor CANNOT delete the student\'s trade (read-only)', async () => {
    await assertFails(deleteDoc(doc(mentor, 'trades', 'trade-1')));
  });

  await check('Admin CAN read any trade', async () => {
    await assertSucceeds(getDoc(doc(admin, 'trades', 'trade-2')));
  });

  await check('a student CANNOT read another student\'s trade', async () => {
    await assertFails(getDoc(doc(otherStudent, 'trades', 'trade-1')));
  });

  await check('a student CAN read their own trade', async () => {
    await assertSucceeds(getDoc(doc(student, 'trades', 'trade-1')));
  });

  console.log('\njournals — mentor scoping\n');

  await check('assigned mentor CAN read their student\'s journal', async () => {
    await assertSucceeds(getDoc(doc(mentor, 'journals', 'journal-1')));
  });

  await check('assigned mentor CANNOT read an unassigned student\'s journal', async () => {
    await assertFails(getDoc(doc(mentor, 'journals', 'journal-2')));
  });

  console.log('\njournals/{id}/mentorComments — the feedback loop\n');

  await check('assigned mentor CAN post a comment on their student\'s journal', async () => {
    await assertSucceeds(setDoc(
      doc(mentor, 'journals', 'journal-1', 'mentorComments', 'c1'),
      commentPayload({ authorId: MENTOR_UID, authorName: 'Mentor One', authorRole: 'Mentor' })
    ));
  });

  await check('journal owner (student) CAN read a comment on their own journal', async () => {
    await assertSucceeds(getDoc(doc(student, 'journals', 'journal-1', 'mentorComments', 'c1')));
  });

  await check('journal owner (student) CAN reply on their own journal', async () => {
    await assertSucceeds(setDoc(
      doc(student, 'journals', 'journal-1', 'mentorComments', 'c2'),
      commentPayload({ authorId: STUDENT_UID, authorName: 'Student One', authorRole: 'Student' })
    ));
  });

  await check('unassigned mentor CANNOT post a comment on an unassigned student\'s journal', async () => {
    await assertFails(setDoc(
      doc(mentor, 'journals', 'journal-2', 'mentorComments', 'c3'),
      commentPayload({ authorId: MENTOR_UID, authorName: 'Mentor One', authorRole: 'Mentor' })
    ));
  });

  await check('unassigned mentor CANNOT read comments on an unassigned student\'s journal', async () => {
    await assertFails(getDoc(doc(mentor, 'journals', 'journal-2', 'mentorComments', 'c1')));
  });

  await check('a student CANNOT post a comment claiming to be their Mentor (role-spoofing)', async () => {
    await assertFails(setDoc(
      doc(student, 'journals', 'journal-1', 'mentorComments', 'c4'),
      commentPayload({ authorId: STUDENT_UID, authorName: 'Student One', authorRole: 'Mentor' })
    ));
  });

  await check('a comment\'s author CANNOT edit it after posting (append-only)', async () => {
    await assertFails(updateDoc(doc(mentor, 'journals', 'journal-1', 'mentorComments', 'c1'), { text: 'Edited.' }));
  });

  await check('a comment\'s author CANNOT delete it', async () => {
    await assertFails(deleteDoc(doc(mentor, 'journals', 'journal-1', 'mentorComments', 'c1')));
  });

  await check('Admin CAN delete a comment (moderation)', async () => {
    await assertSucceeds(deleteDoc(doc(admin, 'journals', 'journal-1', 'mentorComments', 'c1')));
  });

  console.log('\nusers/{userId} — role & mentorId self-write protection\n');

  await check('a student CANNOT self-promote their own role to Admin', async () => {
    await assertFails(updateDoc(doc(student, 'users', STUDENT_UID), { role: 'Admin' }));
  });

  await check('a student CANNOT self-assign their own mentorId', async () => {
    await assertFails(updateDoc(doc(otherStudent, 'users', OTHER_STUDENT_UID), { mentorId: MENTOR_UID }));
  });

  await check('a student CAN update their own name (unrelated field)', async () => {
    await assertSucceeds(updateDoc(doc(student, 'users', STUDENT_UID), { name: 'Updated Name' }));
  });

  await check('Admin CAN change another user\'s role', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'users', OTHER_STUDENT_UID), { role: 'Mentor' }));
  });

  await check('Admin CAN assign a student\'s mentorId', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'users', OTHER_STUDENT_UID), { mentorId: MENTOR_UID }));
  });

  const brandNewUser = testEnv.authenticatedContext('brand-new-uid').firestore();
  const brandNewUser2 = testEnv.authenticatedContext('brand-new-uid-2').firestore();

  await check('a brand-new user CAN create their own profile doc with role Student', async () => {
    await assertSucceeds(setDoc(doc(brandNewUser, 'users', 'brand-new-uid'), { role: 'Student', name: 'New' }));
  });

  await check('a brand-new user CANNOT create their own profile doc with role Admin', async () => {
    await assertFails(setDoc(doc(brandNewUser2, 'users', 'brand-new-uid-2'), { role: 'Admin', name: 'New' }));
  });

  await check('a student CANNOT delete their own profile doc', async () => {
    await assertFails(deleteDoc(doc(student, 'users', STUDENT_UID)));
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
