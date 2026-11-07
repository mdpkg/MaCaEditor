import { expect, test } from "vitest";
import { plantUmlErrorDetail } from "./renderer";

test("recognizes PlantUML diagnostic SVGs without mistaking diagram labels for errors", () => {
  const version = "PlantUML version $version$ / $git.commit.id$ [Unknown compile time]";
  const location = "[From textarea (line 2) ]";
  const syntax = " Syntax Error? (Assumed diagram type: sequence)";
  const diagnostic = `<svg xmlns="http://www.w3.org/2000/svg"><defs/><g>
    <text>${version}</text><text>${location}</text><text>bad &amp; invalid</text><text>${syntax}</text>
  </g></svg>`;
  const diagram = `<svg xmlns="http://www.w3.org/2000/svg"><g>
    <g class="message"><text>${version}</text><text>${location}</text><text>${syntax}</text></g>
  </g></svg>`;

  expect(plantUmlErrorDetail(diagnostic)).toBe(`${version}\n${location}\nbad & invalid\n${syntax}`);
  expect(plantUmlErrorDetail(diagram)).toBeNull();
});
