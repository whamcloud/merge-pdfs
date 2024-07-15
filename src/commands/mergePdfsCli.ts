import { join } from "node:path";
import { writeFileSync } from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { greenBright } from "colorette";

import { mergePDFs } from "../";
import { name, version } from "../../package.json";

export async function mergePdfsCli() {
	const program = yargs(hideBin(process.argv)).scriptName(name)
		.usage("$0 <entry...>")
		.options({
			'o': {
			alias: "output",
			default: "merged-pdf.pdf",
			describe: "Output file",
			type: "string",
			demandOption: false,
		},
		'u': {
			alias: "urls",
			default: [],
			describe: "The source URLs for each PDF. Used to rewrite internal PDF links",
			type: "array",
			demandOption: false,
		},
		'b': {
			alias: "base_url",
			default: "",
			describe: "Only PDF links that begin with this base_url will be rewritten",
			type: "string",
			demandOption: false,
		}
	})
		.example([
			["$0 1.pdf 2.pdf", "Merge two PDFs files"],
			["$0 1.pdf 2.pdf -o merged-pdf.pdf", "Merge two PDFs files into merged-pdf.pdf file"],
			["$0 pdfs/*.pdf -o merged-pdf.pdf", "Merge some PDFs files into merged-pdf.pdf file"],
			["$0 1.pdf 2.pdf -u http://localhost:16762/2.html http://localhost:16762/2.html -b http://localhost:16762 ", "Merge files rewritting internal links"],
		])
		.showHelpOnFail(false)
		.alias("h", "help")
		.version("version", version)
		.alias("v", "version")
		.help();
	const argv = await program.argv;
	const entry = argv._;
	let output = argv.o;
	let base_url = argv.b;
	let urls = argv.u;

	const outBuffer = await mergePDFs(entry as string[], urls as string[], base_url);
	if (!output.endsWith(".pdf"))
		output += ".pdf";

	writeFileSync(output, outBuffer);
	process.stdout.write(greenBright(`\n Saved to ${join(process.cwd(), argv.o)}\n`));
}
