// verify-journal <fichier> [--expect-head <empreinte>] [--expect-seq <n>]
//
// Codes de sortie (specs/04 § 5) :
//    0  chaîne intègre, et tête conforme si elle était demandée
//    1  chaîne rompue : SEQ_MISMATCH, PREV_MISMATCH ou HASH_MISMATCH
//    2  fichier illisible ou entrée non conforme au schéma : FORMAT
//    3  chaîne intègre, mais tête différente de celle attendue : HEAD_MISMATCH
//   64  erreur d'usage
import { readFileSync } from "node:fs";
import { verifyJournalText } from "./verify.ts";
import type { VerifyOptions } from "./verify.ts";

const USAGE = "usage : verify-journal <fichier> [--expect-head <empreinte>] [--expect-seq <n>]";
const SHA256 = /^[0-9a-f]{64}$/;

type Args = { file: string; options: VerifyOptions };

function parseArgs(argv: string[]): Args | null {
  let file: string | undefined;
  const options: VerifyOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--expect-head") {
      const value = argv[(i += 1)];
      if (value === undefined || !SHA256.test(value)) return null;
      options.expectHead = value;
    } else if (arg === "--expect-seq") {
      const value = argv[(i += 1)];
      if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
      options.expectSeq = Number(value);
    } else if (arg.startsWith("--") || file !== undefined) {
      return null;
    } else {
      file = arg;
    }
  }
  return file === undefined ? null : { file, options };
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args === null) {
    console.error(USAGE);
    return 64;
  }
  let text: string;
  try {
    text = readFileSync(args.file, "utf8");
  } catch {
    console.error("FORMAT : fichier illisible");
    return 2;
  }
  const result = verifyJournalText(text, args.options);
  if (result.code === 0) {
    console.log(`${result.count} entrées, tête ${result.headHash}`);
    return 0;
  }
  console.error(`entrée ${result.at} : ${result.defect}`);
  return result.code;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
