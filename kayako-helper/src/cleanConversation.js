/* turn Kayako “post” array ➜ readable chat transcript
   – chronological (oldest → newest)
   – each line: timestamp, author, role, kind (Reply / Note)
   – posts separated by a clear divider                               */

const SEPARATOR = '\n[——— Post separator ———]\n';

/* optional helper: map role.id → label you prefer */
const ROLE_MAP = {
    5: 'Agent',
    4: 'Customer'
};

function roleLabel(post) {
    const id = post?.creator?.role?.id;
    if (id && ROLE_MAP[id]) return ROLE_MAP[id];
    return post.is_requester ? 'Requester' : 'User';
}

function kindLabel(post) {
    return post?.original?.resource_type === 'note' ? 'NOTE' : 'REPLY';
}

/* ------------------------------------------------------------------ */
export function cleanConversation(posts) {
    const lines = posts
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(p => {
            const ts   = new Date(p.created_at).toLocaleString();
            const who  = (p.creator && p.creator.full_name) || 'Unknown';
            const role = roleLabel(p);
            const kind = kindLabel(p);

            const body = (p.contents || '')
                .replace(/\r?\n/g, ' ')   // single‑line
                .replace(/\s+/g, ' ')     // collapse whitespace
                .trim();

            return `[${ts}] ${who} (${role}, ${kind}):\n${body}`;
        });

    return lines.join(SEPARATOR);
}
