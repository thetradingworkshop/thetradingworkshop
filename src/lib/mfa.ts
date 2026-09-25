import {
  Auth,
  User,
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  ApplicationVerifier,
  MultiFactorInfo,
} from 'firebase/auth';

// Phone-based enrollment: send a code to the given number, tied to this
// user's own enrollment session (distinct from the sign-in challenge flow
// in AuthContext.tsx, which uses a MultiFactorResolver's session instead —
// same PhoneAuthProvider, different session source).
export async function sendEnrollmentCode(
  auth: Auth,
  user: User,
  phoneNumber: string,
  verifier: ApplicationVerifier
): Promise<string> {
  const session = await multiFactor(user).getSession();
  const provider = new PhoneAuthProvider(auth);
  return provider.verifyPhoneNumber({ phoneNumber, session }, verifier);
}

export async function finishPhoneEnrollment(
  user: User,
  verificationId: string,
  code: string,
  displayName: string
): Promise<void> {
  const credential = PhoneAuthProvider.credential(verificationId, code);
  const assertion = PhoneMultiFactorGenerator.assertion(credential);
  await multiFactor(user).enroll(assertion, displayName);
}

export function listEnrolledFactors(user: User): MultiFactorInfo[] {
  return multiFactor(user).enrolledFactors;
}

export async function unenrollFactor(user: User, factor: MultiFactorInfo): Promise<void> {
  await multiFactor(user).unenroll(factor);
}
