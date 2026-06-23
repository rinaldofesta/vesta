import React, { useMemo } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { parseMarkdown, type Block, type Inline } from "../lib/markdown/parse";
import { colors, typography } from "../lib/theme";

interface Props {
  content: string;
  color: string;
}

function renderInline(nodes: Inline[], keyPrefix: string): React.ReactNode {
  return nodes.map((n, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (n.t) {
      case "text":
        return <Text key={key}>{n.v}</Text>;
      case "bold":
        return (
          <Text key={key} style={styles.bold}>
            {renderInline(n.children, key)}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={styles.italic}>
            {renderInline(n.children, key)}
          </Text>
        );
      case "code":
        return (
          <Text key={key} style={styles.inlineCode}>
            {n.v}
          </Text>
        );
    }
  });
}

function renderBlock(block: Block, idx: number, color: string): React.ReactNode {
  const key = `b-${idx}`;
  const textStyle = [styles.text, { color }];
  switch (block.t) {
    case "p":
      return (
        <Text key={key} style={textStyle}>
          {renderInline(block.inline, key)}
        </Text>
      );
    case "h": {
      const hStyle =
        [styles.h1, styles.h2, styles.h3, styles.h4, styles.h5, styles.h6][
          block.level - 1
        ] ?? styles.h3;
      return (
        <Text key={key} style={[styles.text, hStyle, { color }]}>
          {renderInline(block.inline, key)}
        </Text>
      );
    }
    case "code":
      return (
        <View key={key} style={styles.codeBlock}>
          <Text style={styles.codeText}>{block.v}</Text>
        </View>
      );
    case "ul":
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listRow}>
              <Text style={[styles.bullet, { color }]}>•</Text>
              <Text style={[textStyle, styles.listText]}>{renderInline(item, `${key}-${i}`)}</Text>
            </View>
          ))}
        </View>
      );
    case "ol":
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listRow}>
              <Text style={[styles.bullet, { color }]}>{i + 1}.</Text>
              <Text style={[textStyle, styles.listText]}>{renderInline(item, `${key}-${i}`)}</Text>
            </View>
          ))}
        </View>
      );
  }
}

export const Markdown = React.memo(function Markdown({ content, color }: Props) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  return <View>{blocks.map((b, i) => renderBlock(b, i, color))}</View>;
});

const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const styles = StyleSheet.create({
  text: {
    ...typography.body,
    marginBottom: 4,
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  inlineCode: {
    fontFamily: mono,
    fontSize: 14,
    backgroundColor: colors.accentMuted,
    color: colors.accent,
  },
  h1: { fontSize: 22, fontWeight: "700", marginTop: 4, marginBottom: 6 },
  h2: { fontSize: 20, fontWeight: "700", marginTop: 4, marginBottom: 6 },
  h3: { fontSize: 18, fontWeight: "700", marginTop: 2, marginBottom: 4 },
  h4: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  h5: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  h6: { fontSize: 14, fontWeight: "700", marginBottom: 4 },
  codeBlock: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 10,
    marginVertical: 6,
  },
  codeText: {
    fontFamily: mono,
    fontSize: 13,
    color: colors.textPrimary,
  },
  list: { marginBottom: 4 },
  listRow: { flexDirection: "row", marginBottom: 2 },
  bullet: { ...typography.body, marginRight: 8, minWidth: 16 },
  listText: { flex: 1, marginBottom: 0 },
});
