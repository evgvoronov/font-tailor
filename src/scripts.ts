// Writing systems the user can pick under "My languages". Ids are Google Fonts subset names.

export interface Script {
	id: string;
	name: string;
	/** Extra subsets downloaded with the main one. */
	extra?: string[];
	/** Google slices CJK fonts into numbered blocks instead of one named subset. */
	cjk?: boolean;
	/** Note line: *italic*, **bold**, ***bold italic***, `code`. */
	line: string;
	heading: string;
	/** Picker sample. */
	sample: string;
}

export const SCRIPTS: Script[] = [
	{ id: 'latin', name: 'Latin', extra: ['latin-ext'], line: 'Plain text, *italic*, **bold**, ***bold italic*** and `code`.', heading: 'Heading', sample: 'The quick brown fox jumps over the lazy dog' },
	{ id: 'cyrillic', name: 'Cyrillic', extra: ['cyrillic-ext'], line: 'Обычный текст, *курсив*, **жирный**, ***жирный курсив*** и `код`.', heading: 'Заголовок', sample: 'Съешь же ещё этих мягких французских булок' },
	{ id: 'greek', name: 'Greek', extra: ['greek-ext'], line: 'Απλό κείμενο, *πλάγια*, **έντονα**, ***έντονα πλάγια*** και `κώδικας`.', heading: 'Επικεφαλίδα', sample: 'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία' },
	{ id: 'vietnamese', name: 'Vietnamese', line: 'Văn bản thường, *nghiêng*, **đậm**, ***đậm nghiêng*** và `mã`.', heading: 'Tiêu đề', sample: 'Tiếng Việt có dấu: ăn quả nhớ kẻ trồng cây' },
	{ id: 'arabic', name: 'Arabic', line: 'نص عادي، *مائل*، **عريض**، ***عريض مائل*** و `شيفرة`.', heading: 'عنوان', sample: 'نص حكيم له سر قاطع وذو شأن عظيم' },
	{ id: 'hebrew', name: 'Hebrew', line: 'טקסט רגיל, *נטוי*, **מודגש**, ***מודגש נטוי*** ו `קוד`.', heading: 'כותרת', sample: 'דג סקרן שט בים מאוכזב ולפתע מצא חברה' },
	{ id: 'thai', name: 'Thai', line: 'ข้อความปกติ *ตัวเอียง* **ตัวหนา** ***ตัวหนาเอียง*** และ `โค้ด`', heading: 'หัวข้อ', sample: 'เป็นมนุษย์สุดประเสริฐเลิศคุณค่า' },
	{ id: 'devanagari', name: 'Devanagari', line: 'सामान्य पाठ, *तिरछा*, **मोटा**, ***मोटा तिरछा*** और `कोड`।', heading: 'शीर्षक', sample: 'ऋषियों को सताने वाले दुष्ट राक्षसों के राजा रावण' },
	{ id: 'japanese', name: 'Japanese', cjk: true, line: '普通のテキスト、*斜体*、**太字**、***太字斜体***、`コード`。', heading: '見出し', sample: 'いろはにほへと ちりぬるを 色は匂へど' },
	{ id: 'korean', name: 'Korean', cjk: true, line: '일반 텍스트, *기울임*, **굵게**, ***굵은 기울임***, `코드`.', heading: '제목', sample: '다람쥐 헌 쳇바퀴에 타고파' },
	{ id: 'chinese-simplified', name: 'Chinese (Simplified)', cjk: true, line: '普通文本，*斜体*，**粗体**，***粗斜体***，`代码`。', heading: '标题', sample: '天地玄黄 宇宙洪荒 日月盈昃' },
	{ id: 'chinese-traditional', name: 'Chinese (Traditional)', cjk: true, line: '普通文字，*斜體*，**粗體**，***粗斜體***，`程式碼`。', heading: '標題', sample: '天地玄黃 宇宙洪荒 日月盈昃' },
	{ id: 'chinese-hongkong', name: 'Chinese (Hong Kong)', cjk: true, line: '普通文字，*斜體*，**粗體**，***粗斜體***，`程式碼`。', heading: '標題', sample: '天地玄黃 宇宙洪荒 日月盈昃' },
];

const BY_ID = new Map(SCRIPTS.map((s) => [s.id, s]));

export function scriptsOf(ids: string[]): Script[] {
	return SCRIPTS.filter((s) => ids.includes(s.id));
}

// Language code (or its prefix) to script. Everything not listed writes in Latin.
const LANG_SCRIPT: Record<string, string> = {
	ru: 'cyrillic', uk: 'cyrillic', be: 'cyrillic', bg: 'cyrillic', sr: 'cyrillic', mk: 'cyrillic',
	kk: 'cyrillic', ky: 'cyrillic', tg: 'cyrillic', mn: 'cyrillic',
	el: 'greek', vi: 'vietnamese', ar: 'arabic', fa: 'arabic', ur: 'arabic', he: 'hebrew', th: 'thai',
	hi: 'devanagari', mr: 'devanagari', ne: 'devanagari', ja: 'japanese', ko: 'korean',
	zh: 'chinese-simplified', 'zh-tw': 'chinese-traditional', 'zh-hant': 'chinese-traditional', 'zh-hk': 'chinese-hongkong',
};

export function scriptForLanguage(lang: string): string {
	const l = lang.toLowerCase();
	return LANG_SCRIPT[l] ?? LANG_SCRIPT[l.split('-')[0] ?? ''] ?? 'latin';
}

/** Latin plus the scripts of the given languages, in table order. */
export function defaultScripts(languages: string[]): string[] {
	const ids = new Set(['latin', ...languages.map(scriptForLanguage)]);
	return SCRIPTS.filter((s) => ids.has(s.id)).map((s) => s.id);
}

/** Chosen scripts the family has no subset for. */
export function missingScripts(subsets: string[], chosen: string[]): Script[] {
	return scriptsOf(chosen).filter((s) => !subsets.includes(s.id));
}

/** Should a block of Google's CSS (labelled by its comment, e.g. "cyrillic" or "[12]") be downloaded? Latin always is: it holds digits and punctuation. */
export function keepsBlock(label: string, chosen: string[]): boolean {
	if (!label) return true;
	const wanted = scriptsOf(['latin', ...chosen]);
	if (/^\[\d+\]$/.test(label)) return wanted.some((s) => s.cjk);
	return wanted.some((s) => s.id === label || s.extra?.includes(label));
}

export function scriptName(id: string): string {
	return BY_ID.get(id)?.name ?? id;
}
