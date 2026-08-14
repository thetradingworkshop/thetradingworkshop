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
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
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

// A trade-intent payload matching isValidTradeIntent(), mirroring what
// TradeContext.logTradeIntent actually writes.
function intentPayload(overrides = {}) {
  return {
    userId: overrides.userId,
    symbol: overrides.symbol ?? 'ES',
    direction: overrides.direction ?? 'LONG',
    isValidSetup: overrides.isValidSetup ?? true,
    overrideUsed: overrides.overrideUsed ?? false,
    confirmedAt: overrides.confirmedAt ?? new Date().toISOString(),
    status: overrides.status ?? 'pending',
    ...(overrides.plannedEntry !== undefined ? { plannedEntry: overrides.plannedEntry } : { plannedEntry: 5000 }),
    ...(overrides.plannedExit !== undefined ? { plannedExit: overrides.plannedExit } : { plannedExit: 5020 }),
    ...(overrides.stopLoss !== undefined ? { stopLoss: overrides.stopLoss } : { stopLoss: 4990 }),
    ...(overrides.strategyId ? { strategyId: overrides.strategyId, strategyName: overrides.strategyName ?? 'Test Strategy' } : {}),
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
  const VIEWER_UID = 'viewer-1';

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN_UID), { role: 'Admin', name: 'Admin One' });
    await setDoc(doc(db, 'users', MENTOR_UID), { role: 'Mentor', name: 'Mentor One' });
    await setDoc(doc(db, 'users', OTHER_MENTOR_UID), { role: 'Mentor', name: 'Mentor Two' });
    await setDoc(doc(db, 'users', STUDENT_UID), { role: 'Student', name: 'Student One', mentorId: MENTOR_UID });
    await setDoc(doc(db, 'users', OTHER_STUDENT_UID), { role: 'Student', name: 'Student Two' }); // no mentorId
    await setDoc(doc(db, 'users', VIEWER_UID), { role: 'Viewer', name: 'Viewer One' });

    await setDoc(doc(db, 'trades', 'viewer-trade-1'), { userId: VIEWER_UID, symbol: 'CL' });
    await setDoc(doc(db, 'journals', 'viewer-journal-1'), { userId: VIEWER_UID, title: 'Old note' });
    await setDoc(doc(db, 'trades', 'trade-1'), { userId: STUDENT_UID, symbol: 'ES' });
    await setDoc(doc(db, 'trades', 'trade-2'), { userId: OTHER_STUDENT_UID, symbol: 'NQ' });
    await setDoc(doc(db, 'journals', 'journal-1'), { userId: STUDENT_UID, title: 'Note' });
    await setDoc(doc(db, 'journals', 'journal-2'), { userId: OTHER_STUDENT_UID, title: 'Note' });

    // Invites + groups fixtures
    await setDoc(doc(db, 'groups', 'group-1'), {
      name: 'Test Cohort', mentorId: MENTOR_UID, createdBy: ADMIN_UID, createdAt: new Date(),
    });
    const NOW = Date.now();
    const future = new Date(NOW + 7 * 24 * 60 * 60 * 1000);
    const past = new Date(NOW - 1000);
    await setDoc(doc(db, 'invites', 'valid-invite'), {
      code: 'valid-invite', role: 'Student', mentorId: MENTOR_UID, groupId: 'group-1',
      label: 'Test Invite', createdBy: ADMIN_UID, createdAt: new Date(),
      expiresAt: future, maxUses: 1, useCount: 0, revoked: false,
    });
    // Three independent copies of the same "multi-use" invite so the three
    // useCount-mutation tests below don't stomp on each other's starting
    // state (each test's update actually mutates the persisted doc).
    for (const id of ['multi-use-invite', 'multi-use-invite-2', 'multi-use-invite-3']) {
      await setDoc(doc(db, 'invites', id), {
        code: id, role: 'Student', mentorId: null, groupId: 'group-1',
        label: 'Cohort Invite', createdBy: ADMIN_UID, createdAt: new Date(),
        expiresAt: future, maxUses: 5, useCount: 2, revoked: false,
      });
    }
    await setDoc(doc(db, 'invites', 'mentor-invite'), {
      code: 'mentor-invite', role: 'Mentor', mentorId: null, groupId: null,
      label: 'New Mentor', createdBy: ADMIN_UID, createdAt: new Date(),
      expiresAt: future, maxUses: 1, useCount: 0, revoked: false,
    });
    await setDoc(doc(db, 'invites', 'expired-invite'), {
      code: 'expired-invite', role: 'Student', mentorId: null, groupId: null,
      label: 'Old', createdBy: ADMIN_UID, createdAt: new Date(),
      expiresAt: past, maxUses: 1, useCount: 0, revoked: false,
    });
    await setDoc(doc(db, 'invites', 'revoked-invite'), {
      code: 'revoked-invite', role: 'Student', mentorId: null, groupId: null,
      label: 'Pulled', createdBy: ADMIN_UID, createdAt: new Date(),
      expiresAt: future, maxUses: 1, useCount: 0, revoked: true,
    });
    await setDoc(doc(db, 'invites', 'exhausted-invite'), {
      code: 'exhausted-invite', role: 'Student', mentorId: null, groupId: null,
      label: 'Used up', createdBy: ADMIN_UID, createdAt: new Date(),
      expiresAt: future, maxUses: 1, useCount: 1, revoked: false,
    });
  });

  const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();
  const mentor = testEnv.authenticatedContext(MENTOR_UID).firestore();
  const otherMentor = testEnv.authenticatedContext(OTHER_MENTOR_UID).firestore();
  const student = testEnv.authenticatedContext(STUDENT_UID).firestore();
  const otherStudent = testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore();
  const viewer = testEnv.authenticatedContext(VIEWER_UID).firestore();

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

  console.log('\nViewer role — read-only enforcement (canWriteOwnData)\n');

  await check('Viewer CAN read their own trade', async () => {
    await assertSucceeds(getDoc(doc(viewer, 'trades', 'viewer-trade-1')));
  });

  await check('Viewer CANNOT create a trade', async () => {
    await assertFails(setDoc(doc(viewer, 'trades', 'viewer-trade-new'), {
      userId: VIEWER_UID, symbol: 'GC', sessionDate: '2026-01-01', direction: 'LONG',
      entryTime: '2026-01-01T00:00:00Z', exitTime: '2026-01-01T01:00:00Z',
      avgEntryPrice: 1, avgExitPrice: 1, pnlPoints: 0, pnlCurrency: 0, isWinner: false,
      holdTimeSeconds: 60, totalQuantity: 1, dedupeHash: 'x', createdAt: new Date(), updatedAt: new Date(),
      totalEntryValue: 1, totalExitValue: 1, realizedPnL: 0, maxPositionSize: 1,
    }));
  });

  await check('Viewer CANNOT update their own trade', async () => {
    await assertFails(updateDoc(doc(viewer, 'trades', 'viewer-trade-1'), { symbol: 'NG' }));
  });

  await check('Viewer CANNOT delete their own trade', async () => {
    await assertFails(deleteDoc(doc(viewer, 'trades', 'viewer-trade-1')));
  });

  await check('Viewer CAN read their own journal', async () => {
    await assertSucceeds(getDoc(doc(viewer, 'journals', 'viewer-journal-1')));
  });

  await check('Viewer CANNOT create a journal entry', async () => {
    await assertFails(setDoc(doc(viewer, 'journals', 'viewer-journal-new'), { userId: VIEWER_UID, title: 'New' }));
  });

  await check('Viewer CANNOT update their own journal', async () => {
    await assertFails(updateDoc(doc(viewer, 'journals', 'viewer-journal-1'), { title: 'Edited' }));
  });

  await check('Viewer CANNOT reply on their own journal (mentorComments)', async () => {
    await assertFails(setDoc(
      doc(viewer, 'journals', 'viewer-journal-1', 'mentorComments', 'v1'),
      commentPayload({ authorId: VIEWER_UID, authorName: 'Viewer One', authorRole: 'Viewer' })
    ));
  });

  await check('Viewer CANNOT create a strategy', async () => {
    await assertFails(setDoc(doc(viewer, 'strategies', 'viewer-strategy-1'), {
      userId: VIEWER_UID, name: 'Test', status: 'active', categories: [],
    }));
  });

  await check('Viewer CAN still update their own name (unrelated field on users/{uid})', async () => {
    await assertSucceeds(updateDoc(doc(viewer, 'users', VIEWER_UID), { name: 'Updated Viewer Name' }));
  });

  await check('Admin CAN still write a Viewer\'s data on their behalf', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'journals', 'viewer-journal-1'), { title: 'Admin edit' }));
  });

  console.log('\ninvites — redemption grants role/mentorId/groupId at account creation\n');

  await check('a brand-new user CAN redeem a valid invite (role+mentor+group match exactly)', async () => {
    const u = testEnv.authenticatedContext('invitee-1').firestore();
    await assertSucceeds(setDoc(doc(u, 'users', 'invitee-1'), {
      role: 'Student', mentorId: MENTOR_UID, groupId: 'group-1', inviteCode: 'valid-invite',
      referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('a brand-new user CAN redeem a Mentor-role invite (role other than Student)', async () => {
    const u = testEnv.authenticatedContext('invitee-mentor').firestore();
    await assertSucceeds(setDoc(doc(u, 'users', 'invitee-mentor'), {
      role: 'Mentor', inviteCode: 'mentor-invite', referredBy: ADMIN_UID, name: 'New Mentor',
    }));
  });

  await check('CANNOT redeem an invite while claiming a different role than it grants', async () => {
    const u = testEnv.authenticatedContext('invitee-2').firestore();
    await assertFails(setDoc(doc(u, 'users', 'invitee-2'), {
      role: 'Admin', mentorId: MENTOR_UID, groupId: 'group-1', inviteCode: 'valid-invite',
      referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('CANNOT redeem an invite while claiming a different mentorId than it grants', async () => {
    const u = testEnv.authenticatedContext('invitee-3').firestore();
    await assertFails(setDoc(doc(u, 'users', 'invitee-3'), {
      role: 'Student', mentorId: OTHER_MENTOR_UID, groupId: 'group-1', inviteCode: 'valid-invite',
      referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('CANNOT redeem an invite while dropping the groupId it grants', async () => {
    const u = testEnv.authenticatedContext('invitee-4').firestore();
    await assertFails(setDoc(doc(u, 'users', 'invitee-4'), {
      role: 'Student', mentorId: MENTOR_UID, inviteCode: 'valid-invite', referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('CANNOT redeem an expired invite', async () => {
    const u = testEnv.authenticatedContext('invitee-5').firestore();
    await assertFails(setDoc(doc(u, 'users', 'invitee-5'), {
      role: 'Student', inviteCode: 'expired-invite', referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('CANNOT redeem a revoked invite', async () => {
    const u = testEnv.authenticatedContext('invitee-6').firestore();
    await assertFails(setDoc(doc(u, 'users', 'invitee-6'), {
      role: 'Student', inviteCode: 'revoked-invite', referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('CANNOT redeem an already-exhausted invite (useCount >= maxUses)', async () => {
    const u = testEnv.authenticatedContext('invitee-7').firestore();
    await assertFails(setDoc(doc(u, 'users', 'invitee-7'), {
      role: 'Student', inviteCode: 'exhausted-invite', referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('CANNOT redeem a nonexistent invite code', async () => {
    const u = testEnv.authenticatedContext('invitee-8').firestore();
    await assertFails(setDoc(doc(u, 'users', 'invitee-8'), {
      role: 'Student', inviteCode: 'made-up-code', referredBy: ADMIN_UID, name: 'Invitee',
    }));
  });

  await check('a redeeming user CAN bump the invite\'s useCount by exactly 1', async () => {
    const u = testEnv.authenticatedContext('invitee-9').firestore();
    await assertSucceeds(updateDoc(doc(u, 'invites', 'multi-use-invite'), { useCount: 3 }));
  });

  await check('a redeeming user CANNOT bump useCount by more than 1', async () => {
    const u = testEnv.authenticatedContext('invitee-10').firestore();
    await assertFails(updateDoc(doc(u, 'invites', 'multi-use-invite-2'), { useCount: 4 }));
  });

  await check('a redeeming user CANNOT change other invite fields while bumping useCount', async () => {
    const u = testEnv.authenticatedContext('invitee-11').firestore();
    await assertFails(updateDoc(doc(u, 'invites', 'multi-use-invite-3'), { useCount: 3, maxUses: 999 }));
  });

  await check('a non-Admin CANNOT create an invite', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'forged-invite'), {
      code: 'forged-invite', role: 'Admin', createdBy: STUDENT_UID, createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000), maxUses: 1, useCount: 0, revoked: false, label: 'x',
    }));
  });

  await check('a non-Admin CANNOT list/enumerate all invites', async () => {
    await assertFails(getDocs(collection(student, 'invites')));
  });

  await check('a non-Admin CAN get one specific invite by its known code', async () => {
    await assertSucceeds(getDoc(doc(student, 'invites', 'valid-invite')));
  });

  await check('a non-Admin CANNOT revoke an invite', async () => {
    await assertFails(updateDoc(doc(student, 'invites', 'valid-invite'), { revoked: true }));
  });

  await check('Admin CAN create an invite', async () => {
    await assertSucceeds(setDoc(doc(admin, 'invites', 'admin-made-invite'), {
      code: 'admin-made-invite', role: 'Student', mentorId: null, groupId: null,
      label: 'Admin Invite', createdBy: ADMIN_UID, createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000), maxUses: 1, useCount: 0, revoked: false,
    }));
  });

  await check('Admin CAN list all invites', async () => {
    await assertSucceeds(getDocs(collection(admin, 'invites')));
  });

  await check('Admin CAN revoke an invite', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'invites', 'valid-invite'), { revoked: true }));
  });

  console.log('\ngroups — organizational label, admin-managed, not an access grant\n');

  await check('any authenticated user CAN read a group', async () => {
    await assertSucceeds(getDoc(doc(student, 'groups', 'group-1')));
  });

  await check('a non-Admin CANNOT create a group', async () => {
    await assertFails(setDoc(doc(student, 'groups', 'rogue-group'), { name: 'Rogue', createdBy: STUDENT_UID }));
  });

  await check('a non-Admin CANNOT edit a group', async () => {
    await assertFails(updateDoc(doc(student, 'groups', 'group-1'), { name: 'Renamed' }));
  });

  await check('Admin CAN create a group', async () => {
    await assertSucceeds(setDoc(doc(admin, 'groups', 'group-2'), { name: 'Admin Cohort', createdBy: ADMIN_UID, createdAt: new Date() }));
  });

  console.log('\ntrade_intents — pre-trade plans (LogIntentModal)\n');

  await check('a user CAN log a complete plan (entry+exit+stop all set)', async () => {
    await assertSucceeds(setDoc(doc(student, 'trade_intents', 'intent-1'), intentPayload({ userId: STUDENT_UID })));
  });

  await check('a user CAN log an incomplete plan (override)', async () => {
    await assertSucceeds(setDoc(doc(student, 'trade_intents', 'intent-2'), intentPayload({
      userId: STUDENT_UID, isValidSetup: false, overrideUsed: true, plannedEntry: undefined, plannedExit: undefined, stopLoss: undefined,
    })));
  });

  await check('a user CAN log a plan with a strategy tagged', async () => {
    await assertSucceeds(setDoc(doc(student, 'trade_intents', 'intent-3'), intentPayload({
      userId: STUDENT_UID, strategyId: 'strategy-1', strategyName: 'ORB Breakout',
    })));
  });

  await check('a user CANNOT log an intent for someone else', async () => {
    await assertFails(setDoc(doc(student, 'trade_intents', 'intent-4'), intentPayload({ userId: OTHER_STUDENT_UID })));
  });

  await check('a user CANNOT log an intent with an invalid direction', async () => {
    await assertFails(setDoc(doc(student, 'trade_intents', 'intent-5'), intentPayload({ userId: STUDENT_UID, direction: 'SIDEWAYS' })));
  });

  await check('a Viewer CANNOT log an intent (read-only)', async () => {
    await assertFails(setDoc(doc(viewer, 'trade_intents', 'intent-6'), intentPayload({ userId: VIEWER_UID })));
  });

  await check('the owner CAN read their own intent', async () => {
    await assertSucceeds(getDoc(doc(student, 'trade_intents', 'intent-1')));
  });

  await check('a different user CANNOT read someone else\'s intent', async () => {
    await assertFails(getDoc(doc(otherStudent, 'trade_intents', 'intent-1')));
  });

  await check('Admin CAN read any intent', async () => {
    await assertSucceeds(getDoc(doc(admin, 'trade_intents', 'intent-1')));
  });

  await check('the owner CAN update their own intent (e.g. mark matched)', async () => {
    await assertSucceeds(updateDoc(doc(student, 'trade_intents', 'intent-1'), { status: 'matched', tradeId: 'trade-99' }));
  });

  await check('a different user CANNOT update someone else\'s intent', async () => {
    await assertFails(updateDoc(doc(otherStudent, 'trade_intents', 'intent-1'), { status: 'matched' }));
  });

  console.log('\npersonal referral links — self-service invites, hard-capped to Student\n');

  const future90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const selfInvitePayload = (overrides = {}) => ({
    code: 'my-ref-code', role: 'Student', mentorId: null, groupId: null,
    label: 'My Referral Link', createdBy: STUDENT_UID, createdByName: 'Student One', createdAt: new Date(),
    expiresAt: future90, maxUses: 500, useCount: 0, revoked: false,
    ...overrides,
  });

  await check('a non-Admin CAN create their own personal referral link (role Student)', async () => {
    await assertSucceeds(setDoc(doc(student, 'invites', 'my-ref-code'), selfInvitePayload()));
  });

  await check('a non-Admin CANNOT self-create a referral link granting Viewer (no longer the grant)', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-1'), selfInvitePayload({ code: 'bad-ref-1', role: 'Viewer' })));
  });

  await check('a non-Admin CANNOT self-create a referral link granting Mentor', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-1b'), selfInvitePayload({ code: 'bad-ref-1b', role: 'Mentor' })));
  });

  await check('a non-Admin CANNOT self-create a referral link granting Admin', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-2'), selfInvitePayload({ code: 'bad-ref-2', role: 'Admin' })));
  });

  await check('a non-Admin CANNOT self-create a referral link for someone else (createdBy spoofed)', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-3'), selfInvitePayload({ code: 'bad-ref-3', createdBy: OTHER_STUDENT_UID })));
  });

  await check('a non-Admin CANNOT self-create a referral link with a mentorId set', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-4'), selfInvitePayload({ code: 'bad-ref-4', mentorId: MENTOR_UID })));
  });

  await check('a non-Admin CANNOT self-create a referral link with a groupId set', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-5'), selfInvitePayload({ code: 'bad-ref-5', groupId: 'group-1' })));
  });

  await check('a non-Admin CANNOT self-create a referral link exceeding the maxUses cap', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-6'), selfInvitePayload({ code: 'bad-ref-6', maxUses: 1001 })));
  });

  await check('a non-Admin CANNOT self-create a referral link expiring beyond 365 days', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-7'), selfInvitePayload({
      code: 'bad-ref-7', expiresAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
    })));
  });

  await check('a non-Admin CANNOT self-create a referral link that starts already partially used', async () => {
    await assertFails(setDoc(doc(student, 'invites', 'bad-ref-8'), selfInvitePayload({ code: 'bad-ref-8', useCount: 1 })));
  });

  await check('a brand-new user CAN redeem a personal referral link and gets referredBy/referredByName', async () => {
    const u = testEnv.authenticatedContext('referred-uid-1').firestore();
    await assertSucceeds(setDoc(doc(u, 'users', 'referred-uid-1'), {
      role: 'Student', inviteCode: 'my-ref-code', referredBy: STUDENT_UID, referredByName: 'Student One', name: 'Referred Person',
    }));
  });

  await check('a referred user CAN write their own trading data (real Student account, not read-only)', async () => {
    const u = testEnv.authenticatedContext('referred-uid-1').firestore();
    await assertSucceeds(setDoc(doc(u, 'journals', 'referred-journal-1'), { userId: 'referred-uid-1', title: 'First trade' }));
  });

  await check('CANNOT redeem a referral link while claiming a different referredBy than its creator', async () => {
    const u = testEnv.authenticatedContext('referred-uid-2').firestore();
    await assertFails(setDoc(doc(u, 'users', 'referred-uid-2'), {
      role: 'Student', inviteCode: 'my-ref-code', referredBy: OTHER_STUDENT_UID, referredByName: 'Someone Else', name: 'Referred Person',
    }));
  });

  await check('CANNOT redeem a referral link while dropping referredBy entirely', async () => {
    const u = testEnv.authenticatedContext('referred-uid-3').firestore();
    await assertFails(setDoc(doc(u, 'users', 'referred-uid-3'), {
      role: 'Student', inviteCode: 'my-ref-code', name: 'Referred Person',
    }));
  });

  await check('a referred user CANNOT later change their own referredBy', async () => {
    const referred = testEnv.authenticatedContext('referred-uid-1').firestore();
    await assertFails(updateDoc(doc(referred, 'users', 'referred-uid-1'), { referredBy: OTHER_STUDENT_UID }));
  });

  await check('a referred user CAN still update unrelated fields (name)', async () => {
    const referred = testEnv.authenticatedContext('referred-uid-1').firestore();
    await assertSucceeds(updateDoc(doc(referred, 'users', 'referred-uid-1'), { name: 'Updated Name' }));
  });

  await check('Admin CAN change a user\'s referredBy', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'users', 'referred-uid-1'), { referredBy: MENTOR_UID }));
  });

  await check('the referral link\'s own creator CAN self-revoke it', async () => {
    await assertSucceeds(updateDoc(doc(student, 'invites', 'my-ref-code'), { revoked: true }));
  });

  await check('a different user CANNOT revoke someone else\'s referral link', async () => {
    await setDoc(doc(admin, 'invites', 'other-persons-ref'), selfInvitePayload({ code: 'other-persons-ref' }), { merge: true });
    await assertFails(updateDoc(doc(otherStudent, 'invites', 'other-persons-ref'), { revoked: true }));
  });

  console.log('\nusers/{userId} — role self-write protection, mentorId self-assign\n');

  await check('a student CANNOT self-promote their own role to Admin', async () => {
    await assertFails(updateDoc(doc(student, 'users', STUDENT_UID), { role: 'Admin' }));
  });

  await check('a student CAN self-assign a mentorId pointing at a real Mentor ("add a mentor later")', async () => {
    await assertSucceeds(updateDoc(doc(otherStudent, 'users', OTHER_STUDENT_UID), { mentorId: MENTOR_UID }));
  });

  await check('a student CAN change their self-assigned mentorId to a different real Mentor', async () => {
    await assertSucceeds(updateDoc(doc(otherStudent, 'users', OTHER_STUDENT_UID), { mentorId: OTHER_MENTOR_UID }));
  });

  await check('a student CAN clear their own mentorId (unassign)', async () => {
    await assertSucceeds(updateDoc(doc(otherStudent, 'users', OTHER_STUDENT_UID), { mentorId: null }));
  });

  await check('a student CANNOT self-assign a mentorId pointing at a non-Mentor account', async () => {
    await assertFails(updateDoc(doc(otherStudent, 'users', OTHER_STUDENT_UID), { mentorId: STUDENT_UID }));
  });

  await check('a student CANNOT self-assign a mentorId pointing at a nonexistent uid', async () => {
    await assertFails(updateDoc(doc(otherStudent, 'users', OTHER_STUDENT_UID), { mentorId: 'no-such-user' }));
  });

  await check('a student CANNOT self-assign someone else\'s mentorId (only their own doc)', async () => {
    await assertFails(updateDoc(doc(otherStudent, 'users', STUDENT_UID), { mentorId: MENTOR_UID }));
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
