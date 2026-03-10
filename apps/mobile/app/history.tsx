import { useState, useCallback, useLayoutEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from "react-native";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { useChatStore } from "../lib/store/chat-store";
import { getAllConversationsWithPreview } from "../lib/storage/database";
import type { ConversationWithPreview } from "../lib/storage/database";
import { colors, spacing, radii, typography } from "../lib/theme";

function formatRelativeDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const hours = date.getHours().toString().padStart(2, "0");
    const mins = date.getMinutes().toString().padStart(2, "0");
    return `Today, ${hours}:${mins}`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[date.getDay()];
  }
  const day = date.getDate();
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[date.getMonth()]} ${day}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + "...";
}

export default function HistoryScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const loadConversation = useChatStore((s) => s.loadConversation);
  const clearConversation = useChatStore((s) => s.clearConversation);
  const deleteAndSwitch = useChatStore((s) => s.deleteAndSwitch);
  const currentConversationId = useChatStore((s) => s.conversationId);
  const [conversations, setConversations] = useState<ConversationWithPreview[]>([]);

  // + button in header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            clearConversation();
            router.back();
          }}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.headerBtnText}>+</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, clearConversation]);

  const refresh = useCallback(async () => {
    const all = await getAllConversationsWithPreview();
    setConversations(all);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleTap = async (conv: ConversationWithPreview) => {
    if (conv.id === currentConversationId) {
      router.back();
      return;
    }
    await loadConversation(conv.id, conv.title);
    router.back();
  };

  const handleDelete = (conv: ConversationWithPreview) => {
    const title = conv.title || "this conversation";
    Alert.alert("Delete", `Delete "${title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteAndSwitch(conv.id);
          await refresh();
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: ConversationWithPreview }) => {
    const isActive = item.id === currentConversationId;

    return (
      <TouchableOpacity
        style={[styles.card, isActive && styles.cardActive]}
        onPress={() => handleTap(item)}
        onLongPress={() => handleDelete(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardTop}>
          <Text
            style={[styles.cardTitle, isActive && styles.cardTitleActive]}
            numberOfLines={1}
          >
            {item.title || "New conversation"}
          </Text>
          <Text style={styles.cardDate}>
            {formatRelativeDate(item.updatedAt)}
          </Text>
        </View>
        {item.preview && (
          <Text style={styles.cardPreview} numberOfLines={1}>
            {truncate(item.preview, 80)}
          </Text>
        )}
        <View style={styles.cardBottom}>
          <Text style={styles.cardCount}>
            {item.messageCount} {item.messageCount === 1 ? "message" : "messages"}
          </Text>
          {isActive && <View style={styles.activeDot} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No conversations yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: 40,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardActive: {
    borderColor: colors.accent,
    borderWidth: 1.5,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  cardTitleActive: {
    color: colors.accent,
  },
  cardDate: {
    color: colors.textMuted,
    ...typography.caption,
  },
  cardPreview: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardCount: {
    color: colors.textMuted,
    ...typography.caption,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  // Header
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  headerBtnText: {
    fontSize: 18,
    color: colors.accent,
    fontWeight: "600",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 120,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 15,
  },
});
