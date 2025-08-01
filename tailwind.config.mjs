/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            "p:has(img)": {
              img: {
                margin: "0 auto",
              },
              em: {
                fontSize: theme("fontSize.sm"),
                paddingInline: theme("padding.4"),
                marginBlockStart: theme("margin.1"),
                marginInline: "auto",
                display: "block",
                width: "fit-content",
              },
            },
            "--tw-prose-body": theme("colors.blackish"),
            "--tw-prose-headings": theme("colors.blackish"),
            "--tw-prose-lead": theme("colors.blackish"),
            "--tw-prose-links": theme("colors.blackish"),
            "--tw-prose-bold": theme("colors.blackish"),
            "--tw-prose-counters": theme("colors.blackish"),
            "--tw-prose-bullets": theme("colors.blackish"),
            "--tw-prose-hr": theme("colors.blackish"),
            "--tw-prose-quotes": theme("colors.blackish"),
            "--tw-prose-quote-borders": theme("colors.blackish"),
            "--tw-prose-captions": theme("colors.blackish"),
            "--tw-prose-code": theme("colors.blackish"),
            "--tw-prose-pre-code": theme("colors.blackish"),
            "--tw-prose-pre-bg": theme("colors.blackish"),
            "--tw-prose-th-borders": theme("colors.blackish"),
            "--tw-prose-td-borders": theme("colors.blackish"),
            "--tw-prose-invert-body": theme("colors.sepia"),
            "--tw-prose-invert-headings": theme("colors.sepia"),
            "--tw-prose-invert-lead": theme("colors.sepia"),
            "--tw-prose-invert-links": theme("colors.sepia"),
            "--tw-prose-invert-bold": theme("colors.sepia"),
            "--tw-prose-invert-counters": theme("colors.sepia"),
            "--tw-prose-invert-bullets": theme("colors.sepia"),
            "--tw-prose-invert-hr": theme("colors.sepia"),
            "--tw-prose-invert-quotes": theme("colors.sepia"),
            "--tw-prose-invert-quote-borders": theme("colors.sepia"),
            "--tw-prose-invert-captions": theme("colors.sepia"),
            "--tw-prose-invert-code": theme("colors.sepia"),
            "--tw-prose-invert-pre-code": theme("colors.sepia"),
            "--tw-prose-invert-pre-bg": "rgb(0 0 0 / 50%)",
            "--tw-prose-invert-th-borders": theme("colors.sepia"),
            "--tw-prose-invert-td-borders": theme("colors.sepia"),
          },
        },
      }),
    },
  },
};
