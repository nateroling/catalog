import markdownIt from "markdown-it";

export default function (eleventyConfig) {
  // breaks: Craft uses \n as a line break inside a block.
  const md = markdownIt({ html: true, linkify: true, breaks: true });
  eleventyConfig.setLibrary("md", md);
  eleventyConfig.addFilter("md", (s) => (s ? md.render(s) : ""));

  eleventyConfig.addPassthroughCopy("content/assets");

  return {
    dir: { input: "content", output: "_site" },
    markdownTemplateEngine: false, // entry bodies are author content, not templates
    htmlTemplateEngine: "njk",
  };
}
