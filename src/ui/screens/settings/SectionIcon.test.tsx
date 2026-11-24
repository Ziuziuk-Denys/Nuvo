import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SectionIcon } from "./SectionIcon";
import { SECTION_ORDER } from "./sections";

it.each(SECTION_ORDER)("draws %s", (id) => {
  expect(renderToStaticMarkup(<SectionIcon id={id} />)).toMatch(/<path /);
});
