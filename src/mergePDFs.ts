import { fileURLToPath } from "node:url";
import type { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { yellowBright } from "colorette";
import fg from "fast-glob";

import { name } from "../package.json";
import { loadPyodide } from "./pyodide/pyodide";
import { formatDate } from ".";

/**
 * @see https://www.uuidgenerator.net/version4
 * UUID v4
 */
export const MERGE_PDF_NAME = "66699f18-ad5a-43c2-a96e-97bddaef0e6b.pdf";
export const MOUNT_DIR = "/" + "991e729a-8f2e-472a-8402-c26bb03b5ea3";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function mergePDFs(entry: string[], urls: string[], base_url: String) {
	const dir = process.cwd();
	const absolutePathArr = fg.sync(entry, {
		ignore: ["node_modules"],
		onlyFiles: true,
		cwd: dir,
		absolute: true,
	}).filter(file => extname(file) === ".pdf");

	if (absolutePathArr.length < 2) {
		process.stdout.write(yellowBright("At least two PDF files.\n"));
		process.exit(1);
	}

	if (urls.length > 0 && absolutePathArr.length != urls.length){
		process.stdout.write(yellowBright("Each PDF must have a URL.\n"));
		process.exit(1);
	}

	const pyodide = await loadPyodide({ indexURL: resolve(__dirname, "pyodide") });
	await pyodide.loadPackage("micropip");
	const micropip = pyodide.pyimport("micropip");

	pyodide.FS.mkdir(MOUNT_DIR);
	pyodide.FS.mount(pyodide.FS.filesystems.NODEFS, { root: __dirname }, MOUNT_DIR);
	/**
	 * @see https://github.com/pyodide/pyodide/issues/3246#issuecomment-1312210155
	 * You need to prefix the path with emfs: or it will be treated as a url
	*/
	await micropip.install(`emfs:${MOUNT_DIR}/pyodide/pypdf-4.3.0-py3-none-any.whl`);

	const tempFileNameArr: string[] = [];
	absolutePathArr.forEach((filePath) => {
		const tempFileName = `/${filePath.split("/").join("-")}`;
		tempFileNameArr.push(tempFileName);
		pyodide.FS.writeFile(tempFileName, readFileSync(filePath), { encoding: "utf8" });
	});

	const curDate = formatDate(new Date());

	await pyodide.runPythonAsync(`
		from pypdf import PdfWriter, PdfReader
		from pypdf.annotations import Link
		from pypdf.generic import Fit
		from json import loads

		writer = PdfWriter()
		writer.add_metadata(
				{
						"/CreationDate": "${curDate}",
						"/ModDate": "${curDate}",
						"/Creator": "${name}",
						"/Producer": "pypdf - ${name}",
				}
		)

		pdfs = loads('${JSON.stringify(tempFileNameArr)}')
		urls = loads('${JSON.stringify(urls)}')

		if len(urls) == 0:
			for path in pdfs:
				writer.append(path)
		else:
			url_to_page = {}

			# Merge the PDFs into a single document
			for pdf, url in zip(pdfs, urls):
					url_to_page[url] = writer.get_num_pages()
					writer.append(pdf)

			# Go through the Annotations
			to_add = []
			to_del = []
			for page_no, page in enumerate(writer.pages):
					if "/Annots" in page:
							for annot_id in page["/Annots"]:
									annot = annot_id.get_object()
									if "/A" in annot:
											if "/URI" in annot["/A"] and annot["/A"]["/URI"].startswith(
													"${base_url}"
											):
													url = annot["/A"]["/URI"]
													page = url.split("/")[-1]
													# HTML anchor are complied to PDF named destinations
													if "#" in page:
															# PDF named desinations have a leading "/"
															anchor = "/" + page.split("#")[-1]
															if anchor in writer.named_destinations:
																	named_dest = writer.named_destinations[anchor]
																	dest_page = writer.get_page_number(
																			named_dest["/Page"].get_object()
																	)
																	# Create a link based on the named destination
																	to_add.append(
																			(
																					page_no,
																					Link(
																							border=annot["/Border"],
																							rect=annot["/Rect"],
																							target_page_index=dest_page,
																							fit=Fit(
																									fit_type=named_dest["/Type"],
																									fit_args=(
																											named_dest["/Left"],
																											named_dest["/Top"],
																											named_dest["/Zoom"],
																									),
																							),
																					),
																			)
																	)
																	to_del.append((page_no, annot_id))
															else:
																	print(
																			"Problem anchor on page {}: {}".format(
																					page_no, annot
																			)
																	)
													else:
															# For URLS that end in "/", a.k.a without a page, we set the page to index.html
															if page == "":
																	url += "index.html"

															if url in url_to_page:
																	# Convert link to to a URL
																	to_add.append(
																			(
																					page_no,
																					Link(
																							border=annot["/Border"],
																							rect=annot["/Rect"],
																							target_page_index=url_to_page[url],
																					),
																			)
																	)
																	to_del.append((page_no, annot_id))
															else:
																	print(
																			"Problem link on page {}: {}".format(page_no, annot)
																	)

			for page_num, annotation in to_del:
					del writer.pages[page_num]["/Annots"][
							writer.pages[page_num]["/Annots"].index(annotation.indirect_reference)
					]

			for page_num, annotation in to_add:
					writer.add_annotation(page_number=page_num, annotation=annotation)

		writer.write("/${MERGE_PDF_NAME}")
		writer.close()
	`);

	const outBuffer: Buffer = pyodide.FS.readFile(`/${MERGE_PDF_NAME}`);

	return outBuffer;
}

export default mergePDFs;
