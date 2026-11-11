//#region src/otp.d.ts
/**
 * Secrets stay as bytes so `url()` can encode them synchronously.
 * A `CryptoKey` only exposes its bytes when extractable and fixes its own hash.
 */
type OTPSecret = string | Uint8Array | ArrayBuffer;
/**
 * Strings are used as UTF-8 bytes.
 * Decode encoded secrets, such as Base32, before passing them in.
 */
declare const createOTP: (secret: OTPSecret, opts?: {
  digits?: number;
  period?: number;
}) => {
  hotp: (counter: number) => Promise<string>;
  totp: () => Promise<string>;
  verify: (otp: string, options?: {
    window?: number;
  }) => Promise<boolean>;
  url: (issuer: string, account: string) => string;
};
//#endregion
export { createOTP };