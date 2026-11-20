# Third-party notices

TeXloom source code is licensed under the MIT License in `LICENSE`. It uses the
following directly installed open-source packages. Their own licenses continue
to apply:

| Package | License |
| --- | --- |
| React, React DOM, Monaco Editor, `@monaco-editor/react` | MIT |
| Fastify, `@fastify/static`, `@fastify/multipart`, `adm-zip` | MIT |
| Lucide React | ISC |
| PDF.js (`pdfjs-dist`) | Apache-2.0 |

The Windows compiler in `runtime/tectonic.exe` is the [Tectonic project](https://github.com/tectonic-typesetting/tectonic),
licensed under MIT. Tectonic incorporates work from TeX and XeTeX with
additional third-party notices; consult the [upstream license](https://github.com/tectonic-typesetting/tectonic/blob/master/LICENSE)
and its release materials when redistributing the executable.

Copies of the PDF.js, Lucide and Tectonic license texts are included in
`licenses/`.

The npm dependency tree is recorded in `package-lock.json`. Package archives
under `node_modules` retain their original license files. A bundled release
should include the licenses for all redistributed dependencies and binaries.
