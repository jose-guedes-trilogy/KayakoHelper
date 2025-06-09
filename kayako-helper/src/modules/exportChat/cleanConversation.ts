// modules/cleanConversation.ts

/* turn Kayako “post” array ➜ readable chat transcript
   – chronological (oldest → newest)
   – each line: timestamp, author, role, kind (Reply / Note)
   – posts separated by a clear divider                               */

const SEPARATOR = '\n[——— Post separator ———]\n';

/* optional helper: map role.id → label you prefer */
const ROLE_MAP: Record<number, string> = {
    5: 'Agent',
    4: 'Customer',
};

interface Role {
    id?: number;
}

interface Creator {
    full_name?: string;
    role?: Role;
}

interface Original {
    resource_type?: string;
}

export interface Post {
    created_at: string;
    creator?: Creator;
    original?: Original;
    contents?: string;
    is_requester?: boolean;
}

function roleLabel(post: Post): string {
    const id = post.creator?.role?.id;
    if (id && ROLE_MAP[id]) {
        return ROLE_MAP[id];
    }
    return post.is_requester ? 'Requester' : 'User';
}

function kindLabel(post: Post): 'NOTE' | 'REPLY' {
    return post.original?.resource_type === 'note' ? 'NOTE' : 'REPLY';
}

/* ------------------------------------------------------------------ */
export function cleanConversation(posts: Post[]): string {
    const lines = posts
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((p) => {
            const ts = new Date(p.created_at).toLocaleString();
            const who = p.creator?.full_name ?? 'Unknown';
            const role = roleLabel(p);
            const kind = kindLabel(p);

            const body = (p.contents ?? '')
                .replace(/\r?\n/g, ' ')   // single-line
                .replace(/\s+/g, ' ')     // collapse whitespace
                .trim();

            return `[${ts}] ${who} (${role}, ${kind}):\n${body}`;
        });

    return lines.join(SEPARATOR);
}
