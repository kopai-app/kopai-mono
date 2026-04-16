import { createRendererFromCatalog, createCatalog } from "@kopai/ui";
import { z } from "zod";

const catalog = createCatalog({
  name: "hello world catalog",
  components: {
    PlainText: {
      description: "displays static textual content",
      hasChildren: false,
      props: z.object({
        content: z.string(),
      }),
    },
    Stack: {
      props: z.object({
        direction: z.enum(["horizontal", "vertical"]).nullable(),
        gap: z.enum(["sm", "md", "lg"]).nullable(),
        align: z.enum(["start", "center", "end", "stretch"]).nullable(),
      }),
      hasChildren: true,
      description: "Flex stack for horizontal or vertical layouts",
    },
  },
});

const ExampleUiTreeRenderer = createRendererFromCatalog(catalog, {
  // a leaf component
  PlainText({ element }) {
    const { content } = element.props;

    return <p style={{ margin: 0 }}>{content}</p>;
  },

  // a container component
  Stack({ element, children }) {
    const { direction, gap, align } = element.props;
    const gaps: Record<string, string> = {
      sm: "8px",
      md: "16px",
      lg: "24px",
    };
    const alignments: Record<string, string> = {
      start: "flex-start",
      center: "center",
      end: "flex-end",
      stretch: "stretch",
    };

    return (
      <div
        style={{
          display: "flex",
          flexDirection: direction === "horizontal" ? "row" : "column",
          gap: gaps[gap ?? "md"],
          alignItems: alignments[align ?? "stretch"],
        }}
      >
        {children}
      </div>
    );
  },
});

type UiTree = z.infer<typeof catalog.uiTreeSchema>;

function TypedRenderer({ tree }: { tree: UiTree }) {
  return <ExampleUiTreeRenderer tree={tree} />;
}

const uiTree = {
  root: "stackContainer",
  elements: {
    stackContainer: {
      key: "stackContainer",
      type: "Stack",
      children: ["test", "test2"],
      parentKey: "",
      props: {
        align: "center",
        direction: "vertical",
        gap: "sm",
      },
    },
    test: {
      key: "test",
      type: "PlainText" as const,
      props: {
        content: "Hello UI Tree",
      },
      parentKey: "stackContainer",
      children: [],
    },
    test2: {
      key: "test2",
      type: "PlainText" as const,
      props: {
        content: "Hello from below",
      },
      parentKey: "stackContainer",
      children: [],
    },
  },
} satisfies UiTree;

export function ExampleWithStaticData() {
  return <TypedRenderer tree={uiTree} />;
}
