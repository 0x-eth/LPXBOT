type Hex = `0x${string}`;

export type ObservedHelperPathName =
  | "observed-v3-path-a"
  | "observed-v3-path-b"
  | "observed-v4-path-a"
  | "observed-v4-path-b";

export interface ObservedHelperPathDefinition {
  allowedPlatformIds: readonly number[];
  generation: "v3" | "v4";
  headWordCount: number;
  name: ObservedHelperPathName;
  selector: Hex;
}

export const OBSERVED_HELPER_PATHS = {
  "observed-v3-path-a": {
    allowedPlatformIds: [1, 2],
    generation: "v3",
    headWordCount: 15,
    name: "observed-v3-path-a",
    selector: "0xadc3f25c",
  },
  "observed-v3-path-b": {
    allowedPlatformIds: [1, 2],
    generation: "v3",
    headWordCount: 13,
    name: "observed-v3-path-b",
    selector: "0xfb691fd9",
  },
  "observed-v4-path-a": {
    allowedPlatformIds: [4, 5],
    generation: "v4",
    headWordCount: 18,
    name: "observed-v4-path-a",
    selector: "0x71fa74ed",
  },
  "observed-v4-path-b": {
    allowedPlatformIds: [4, 5],
    generation: "v4",
    headWordCount: 19,
    name: "observed-v4-path-b",
    selector: "0x5dfd8e50",
  },
} as const satisfies Record<ObservedHelperPathName, ObservedHelperPathDefinition>;

const pathBySelector = new Map<string, ObservedHelperPathDefinition>(
  Object.values(OBSERVED_HELPER_PATHS).map((definition) => [
    definition.selector,
    definition,
  ]),
);
const canonicalHexPattern = /^0x(?:[0-9a-f]{2})+$/u;
const wordPattern = /^[0-9a-f]{64}$/u;

export interface DecodedObservedHelperCalldata {
  dynamicBytes: Hex;
  dynamicPaddingBytes: number;
  opaqueHeadWords: readonly string[];
  path: ObservedHelperPathName;
  platformId: number;
  selector: Hex;
}

function invalid(message: string): never {
  throw new Error(`OBSERVED_HELPER_CALLDATA_INVALID: ${message}`);
}

function toSafeNumber(word: string, label: string): number {
  const value = BigInt(`0x${word}`);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(`${label} exceeds safe integer range`);
  return Number(value);
}

function paddingFor(byteLength: number): number {
  return (32 - (byteLength % 32)) % 32;
}

function lengthWord(byteLength: number): string {
  return byteLength.toString(16).padStart(64, "0");
}

function definitionForSelector(selector: string): ObservedHelperPathDefinition {
  const definition = pathBySelector.get(selector as Hex);
  if (!definition) invalid(`selector ${selector} is not frozen`);
  return definition;
}

// This codec exists only to replay frozen observations. Opaque words must not be
// promoted into a production ABI until their semantics are independently proven.
export class ObservedHelperCodec {
  static decode(calldata: string): DecodedObservedHelperCalldata {
    if (!canonicalHexPattern.test(calldata) || calldata.length < 10 + 64 * 2) {
      invalid("calldata must be lowercase, byte-aligned hex with an ABI head");
    }
    const selector = calldata.slice(0, 10) as Hex;
    const definition = definitionForSelector(selector);
    const argumentsHex = calldata.slice(10);
    if (argumentsHex.length % 64 !== 0) invalid("ABI arguments are not word-aligned");

    const dynamicOffset = toSafeNumber(argumentsHex.slice(64, 128), "dynamic offset");
    if (dynamicOffset !== definition.headWordCount * 32) {
      invalid(`${definition.name} dynamic offset does not match its frozen head`);
    }
    const dynamicOffsetHex = dynamicOffset * 2;
    const opaqueHeadWords = Array.from({ length: definition.headWordCount }, (_, index) =>
      argumentsHex.slice(index * 64, (index + 1) * 64),
    );
    if (opaqueHeadWords.some((word) => !wordPattern.test(word))) {
      invalid("ABI head contains a malformed word");
    }

    const platformId = toSafeNumber(opaqueHeadWords[0] ?? "", "platform ID");
    if (!(definition.allowedPlatformIds as readonly number[]).includes(platformId)) {
      invalid(`${definition.name} rejects platform ID ${platformId}`);
    }
    const dynamicLengthWord = argumentsHex.slice(dynamicOffsetHex, dynamicOffsetHex + 64);
    if (!wordPattern.test(dynamicLengthWord)) invalid("dynamic bytes length word is missing");
    const dynamicLength = toSafeNumber(dynamicLengthWord, "dynamic bytes length");
    const dynamicStart = dynamicOffsetHex + 64;
    const dynamicEnd = dynamicStart + dynamicLength * 2;
    const paddingBytes = paddingFor(dynamicLength);
    const paddedEnd = dynamicEnd + paddingBytes * 2;
    if (paddedEnd !== argumentsHex.length) invalid("dynamic bytes tail length is not canonical");
    if (!/^0*$/u.test(argumentsHex.slice(dynamicEnd, paddedEnd))) {
      invalid("dynamic bytes padding is non-zero");
    }

    return {
      dynamicBytes: `0x${argumentsHex.slice(dynamicStart, dynamicEnd)}`,
      dynamicPaddingBytes: paddingBytes,
      opaqueHeadWords,
      path: definition.name,
      platformId,
      selector,
    };
  }

  static encode(decoded: DecodedObservedHelperCalldata): Hex {
    const definition = OBSERVED_HELPER_PATHS[decoded.path];
    if (decoded.selector !== definition.selector) invalid("path and selector disagree");
    if (decoded.opaqueHeadWords.length !== definition.headWordCount) {
      invalid(`${decoded.path} head word count changed`);
    }
    if (decoded.opaqueHeadWords.some((word) => !wordPattern.test(word))) {
      invalid("ABI head contains a malformed word");
    }
    const platformId = toSafeNumber(decoded.opaqueHeadWords[0] ?? "", "platform ID");
    if (
      platformId !== decoded.platformId ||
      !(definition.allowedPlatformIds as readonly number[]).includes(platformId)
    ) {
      invalid("platform ID changed or is not allowed for the observed generation");
    }
    const dynamicOffset = toSafeNumber(
      decoded.opaqueHeadWords[1] ?? "",
      "dynamic offset",
    );
    if (dynamicOffset !== definition.headWordCount * 32) {
      invalid("dynamic offset changed");
    }
    if (!/^0x(?:[0-9a-f]{2})*$/u.test(decoded.dynamicBytes)) {
      invalid("dynamic bytes must be lowercase byte-aligned hex");
    }
    const dynamicHex = decoded.dynamicBytes.slice(2);
    const dynamicLength = dynamicHex.length / 2;
    const paddingBytes = paddingFor(dynamicLength);
    if (decoded.dynamicPaddingBytes !== paddingBytes) invalid("dynamic padding length changed");

    return `${definition.selector}${decoded.opaqueHeadWords.join("")}${lengthWord(
      dynamicLength,
    )}${dynamicHex}${"00".repeat(paddingBytes)}`;
  }
}
