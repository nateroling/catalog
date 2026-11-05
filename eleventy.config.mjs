import markdownIt from "markdown-it";
import { HtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  // breaks: Craft uses \n as a line break inside a block.
  const md = markdownIt({ html: true, linkify: true, breaks: true });
  eleventyConfig.setLibrary("md", md);
  eleventyConfig.addFilter("md", (s) => (s ? md.render(s) : ""));

  eleventyConfig.addPassthroughCopy("content/assets");

  // Rewrites root-relative href/src (e.g. /001-x/) to include pathPrefix, so the site
  // works both at a domain root and under a subpath like nateroling.github.io/catalog/.
  eleventyConfig.addPlugin(HtmlBasePlugin);

  return {
    dir: { input: "content", output: "_site" },
    // "/" for a custom domain; "/catalog/" for the github.io project URL.
    pathPrefix: process.env.PATH_PREFIX || "/",
    markdownTemplateEngine: false, // entry bodies are author content, not templates
    htmlTemplateEngine: "njk",
  };
}
