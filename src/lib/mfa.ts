import {
  User,
  multiFactor,
  TotpMultiFactorGenerator,
  TotpSecret,
  MultiFactorInfo,
} from 'firebase/auth';

export async function beginTotpEnrollment(user: User): Promise<TotpSecret> {
  const session = await multiFactor(user).getSession();
  return TotpMultiFactorGenerator.generateSecret(session);
}

export async function finishTotpEnrollment(
  user: User,
  secret: TotpSecret,
  oneTimeCode: string,
  displayName: string
): Promise<void> {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, oneTimeCode);
  await multiFactor(user).enroll(assertion, displayName);
}

export function listEnrolledFactors(user: User): MultiFactorInfo[] {
  return multiFactor(user).enrolledFactors;
}

export async function unenrollFactor(user: User, factor: MultiFactorInfo): Promise<void> {
  await multiFactor(user).unenroll(factor);
}
