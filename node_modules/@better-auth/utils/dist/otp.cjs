Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_base32 = require("./base32.cjs");
const require_hmac = require("./hmac.cjs");
//#region src/otp.ts
const defaultPeriod = 30;
const defaultDigits = 6;
const hmac = require_hmac.createHMAC("SHA-1");
/**
* loops over `expected.length` so timing never depends on input length
*
* @internal
*/
function constantTimeEqualOTP(input, expected) {
	let difference = input.length ^ expected.length;
	for (let i = 0; i < expected.length; i++) difference |= input.charCodeAt(i) ^ expected.charCodeAt(i);
	return difference === 0;
}
async function generateHOTP(key, { counter, digits }) {
	const _digits = digits ?? defaultDigits;
	if (_digits < 1 || _digits > 8) throw new TypeError("Digits must be between 1 and 8");
	const buffer = /* @__PURE__ */ new ArrayBuffer(8);
	new DataView(buffer).setBigUint64(0, BigInt(counter), false);
	const bytes = new Uint8Array(buffer);
	const signature = await hmac.sign(key, bytes);
	const hmacResult = new Uint8Array(signature);
	const offset = hmacResult[hmacResult.length - 1] & 15;
	return (((hmacResult[offset] & 127) << 24 | (hmacResult[offset + 1] & 255) << 16 | (hmacResult[offset + 2] & 255) << 8 | hmacResult[offset + 3] & 255) % 10 ** _digits).toString().padStart(_digits, "0");
}
async function generateTOTP(key, options) {
	const digits = options?.digits ?? defaultDigits;
	const milliseconds = (options?.period ?? defaultPeriod) * 1e3;
	return await generateHOTP(key, {
		counter: Math.floor(Date.now() / milliseconds),
		digits
	});
}
async function verifyTOTP(otp, { window = 1, digits = defaultDigits, key, period = defaultPeriod }) {
	const milliseconds = period * 1e3;
	const counter = Math.floor(Date.now() / milliseconds);
	let matched = false;
	for (let i = -window; i <= window; i++) matched = constantTimeEqualOTP(otp, await generateHOTP(key, {
		counter: counter + i,
		digits
	})) || matched;
	return matched;
}
/**
* Generate a QR code URL for the OTP secret
*/
function generateQRCode({ issuer, account, secret, digits = defaultDigits, period = defaultPeriod }) {
	const baseURI = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
	const params = new URLSearchParams({
		secret: require_base32.base32.encode(secret, { padding: false }),
		issuer
	});
	if (digits !== void 0) params.set("digits", digits.toString());
	if (period !== void 0) params.set("period", period.toString());
	return `${baseURI}?${params.toString()}`;
}
/**
* Strings are used as UTF-8 bytes.
* Decode encoded secrets, such as Base32, before passing them in.
*/
const createOTP = (secret, opts) => {
	const digits = opts?.digits ?? defaultDigits;
	const period = opts?.period ?? defaultPeriod;
	return {
		hotp: async (counter) => {
			return generateHOTP(await hmac.importKey(secret, "sign"), {
				counter,
				digits
			});
		},
		totp: async () => {
			return generateTOTP(await hmac.importKey(secret, "sign"), {
				digits,
				period
			});
		},
		verify: async (otp, options) => {
			return verifyTOTP(otp, {
				key: await hmac.importKey(secret, "sign"),
				digits,
				period,
				...options
			});
		},
		url: (issuer, account) => {
			return generateQRCode({
				issuer,
				account,
				secret,
				digits,
				period
			});
		}
	};
};
//#endregion
exports.createOTP = createOTP;
