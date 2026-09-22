from pathlib import Path
import math
import re
from collections import Counter


# =========================================================
# KNOWLEDGE BASE LOCATION
# =========================================================

CURRENT_DIR = Path(__file__).resolve().parent

KNOWLEDGE_CANDIDATES = [
    CURRENT_DIR / "knowledge",
    CURRENT_DIR.parent / "knowledge",
]

KNOWLEDGE_DIR = next(
    (
        path
        for path in KNOWLEDGE_CANDIDATES
        if path.exists() and path.is_dir()
    ),
    CURRENT_DIR / "knowledge",
)


# =========================================================
# STOP WORDS
# =========================================================

STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "can",
    "could",
    "do",
    "does",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "please",
    "the",
    "this",
    "to",
    "what",
    "when",
    "where",
    "which",
    "who",
    "with",
    "would",
    "you",
    "your",
}


# =========================================================
# TOPIC KEYWORDS
# =========================================================

TOPIC_KEYWORDS = {
    "appointments.txt": {
        "appointment",
        "appointments",
        "book",
        "booking",
        "schedule",
        "scheduled",
        "doctor",
        "gp",
        "visit",
        "slot",
        "availability",
        "see",
    },

    "prescriptions.txt": {
        "prescription",
        "prescriptions",
        "repeat",
        "medicine",
        "medication",
        "tablet",
        "tablets",
        "drug",
        "pharmacy",
    },

    "opening_hours.txt": {
        "open",
        "opening",
        "close",
        "closes",
        "closed",
        "hours",
        "hour",
        "friday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "saturday",
        "sunday",
        "time",
    },

    "practice_services.txt": {
        "service",
        "services",
        "provide",
        "provides",
        "offer",
        "offers",
        "practice",
        "facilities",
        "support",
        "clinic",
    },

    "referrals.txt": {
        "referral",
        "referrals",
        "refer",
        "specialist",
        "specialists",
        "hospital",
    },

    "test_results.txt": {
        "test",
        "tests",
        "result",
        "results",
        "blood",
        "laboratory",
        "lab",
        "portal",
        "report",
    },
}


# =========================================================
# TEXT NORMALIZATION
# =========================================================

def normalize_text(text: str) -> str:
    """
    Normalize whitespace while preserving readable text.
    """

    text = text.replace("\r\n", "\n")

    text = re.sub(
        r"[ \t]+",
        " ",
        text,
    )

    text = re.sub(
        r"\n{3,}",
        "\n\n",
        text,
    )

    return text.strip()


# =========================================================
# TOKENIZATION
# =========================================================

def tokenize(text: str) -> list[str]:
    """
    Convert text into normalized lowercase tokens.

    Common stop words are removed.
    """

    words = re.findall(
        r"\b[a-zA-Z0-9]+\b",
        text.lower(),
    )

    return [
        word
        for word in words
        if word not in STOP_WORDS
    ]


# =========================================================
# HEADING DETECTION
# =========================================================

def looks_like_heading(text: str) -> bool:
    """
    Detect simple heading-only paragraphs.

    Examples:

        PRACTICE SERVICES
        TEST RESULTS INFORMATION
        REFERRAL INFORMATION
    """

    clean = text.strip()

    if not clean:
        return False

    words = clean.split()

    # Very short paragraphs are likely headings.
    if len(words) <= 7:

        # All-uppercase heading
        if clean.upper() == clean:
            return True

        # Common heading patterns
        heading_words = {
            "information",
            "services",
            "hours",
            "details",
            "information:",
        }

        if any(
            word.lower().strip(":")
            in heading_words
            for word in words
        ):
            return True

    return False


# =========================================================
# SPLIT LONG TEXT
# =========================================================

def split_long_text(
    text: str,
    max_chars: int = 700,
) -> list[str]:
    """
    Split long paragraphs into smaller chunks.
    """

    if len(text) <= max_chars:
        return [text]

    words = text.split()

    chunks = []

    current_words = []
    current_length = 0

    for word in words:

        word_length = len(word) + 1

        if (
            current_words
            and current_length + word_length > max_chars
        ):
            chunks.append(
                " ".join(current_words)
            )

            current_words = []
            current_length = 0

        current_words.append(word)
        current_length += word_length

    if current_words:
        chunks.append(
            " ".join(current_words)
        )

    return chunks


# =========================================================
# CHUNK DOCUMENT
# =========================================================

def chunk_document(
    content: str,
    max_chars: int = 700,
) -> list[str]:
    """
    Break a document into answer-bearing chunks.

    Important improvement:
    short headings are merged with the following paragraph
    instead of becoming useless standalone chunks.
    """

    content = normalize_text(content)

    if not content:
        return []

    paragraphs = [
        paragraph.strip()
        for paragraph in content.split("\n\n")
        if paragraph.strip()
    ]

    merged_paragraphs = []

    index = 0

    while index < len(paragraphs):

        paragraph = paragraphs[index]

        # -------------------------------------------------
        # Heading + following paragraph
        # -------------------------------------------------

        if (
            looks_like_heading(paragraph)
            and index + 1 < len(paragraphs)
        ):

            combined = (
                paragraph
                + "\n"
                + paragraphs[index + 1]
            )

            merged_paragraphs.append(
                combined
            )

            index += 2

        else:

            merged_paragraphs.append(
                paragraph
            )

            index += 1

    chunks = []

    for paragraph in merged_paragraphs:

        chunks.extend(
            split_long_text(
                paragraph,
                max_chars=max_chars,
            )
        )

    return chunks


# =========================================================
# LOAD KNOWLEDGE BASE
# =========================================================

def load_documents():
    """
    Load all TXT files and convert them into chunks.
    """

    documents = []

    if not KNOWLEDGE_DIR.exists():
        return documents

    for file_path in sorted(
        KNOWLEDGE_DIR.glob("*.txt")
    ):

        try:

            content = file_path.read_text(
                encoding="utf-8"
            )

        except Exception:
            continue

        chunks = chunk_document(
            content
        )

        for index, chunk in enumerate(chunks):

            documents.append(
                {
                    "source": file_path.name,
                    "chunk_id": index,
                    "content": chunk,
                    "tokens": tokenize(chunk),
                }
            )

    return documents


# =========================================================
# IDF
# =========================================================

def calculate_idf(documents):
    """
    Calculate inverse document frequency.
    """

    total_documents = len(documents)

    if total_documents == 0:
        return {}

    document_frequency = Counter()

    for document in documents:

        unique_tokens = set(
            document["tokens"]
        )

        for token in unique_tokens:
            document_frequency[token] += 1

    idf = {}

    for token, frequency in document_frequency.items():

        idf[token] = (
            math.log(
                (total_documents + 1)
                / (frequency + 1)
            )
            + 1
        )

    return idf


# =========================================================
# TOPIC DETECTION
# =========================================================

def detect_topics(query: str) -> dict[str, int]:
    """
    Detect which knowledge document is most likely
    relevant to the query.
    """

    query_tokens = set(
        tokenize(query)
    )

    topic_scores = {}

    for filename, keywords in TOPIC_KEYWORDS.items():

        matches = (
            query_tokens.intersection(
                keywords
            )
        )

        if matches:
            topic_scores[filename] = len(
                matches
            )

    return topic_scores


# =========================================================
# FILENAME TOKENS
# =========================================================

def filename_tokens(
    source: str,
) -> set[str]:

    stem = Path(
        source
    ).stem.replace(
        "_",
        " ",
    )

    return set(
        tokenize(stem)
    )


# =========================================================
# SCORE CHUNK
# =========================================================

def score_chunk(
    query: str,
    query_tokens: list[str],
    document: dict,
    idf: dict,
    topic_scores: dict[str, int],
) -> float:
    """
    Calculate chunk relevance.

    Scoring considers:

    1. TF-IDF style relevance
    2. Query coverage
    3. Exact phrase matching
    4. Filename matching
    5. Topic matching
    6. Answer-bearing content
    7. Specific query-detail matching

    The specific-detail matching is especially useful for
    questions such as:

        "What time does the surgery close on Friday?"

    where "Friday" should strongly prefer the Friday chunk
    over Monday/Tuesday/etc.
    """

    if not query_tokens:
        return 0.0

    chunk_tokens = document["tokens"]

    if not chunk_tokens:
        return 0.0

    query_set = set(query_tokens)
    chunk_set = set(chunk_tokens)

    score = 0.0

    # =====================================================
    # 1. TF-IDF
    # =====================================================

    chunk_counts = Counter(
        chunk_tokens
    )

    for token in query_tokens:

        if token not in chunk_set:
            continue

        frequency = chunk_counts[token]

        score += (
            (1 + math.log(frequency))
            * idf.get(
                token,
                1.0,
            )
        )

    # =====================================================
    # 2. QUERY COVERAGE
    # =====================================================

    matched_tokens = (
        query_set.intersection(
            chunk_set
        )
    )

    if matched_tokens:

        coverage = (
            len(matched_tokens)
            / len(query_set)
        )

        score += (
            coverage * 3.0
        )

    # =====================================================
    # 3. EXACT PHRASE MATCH
    # =====================================================

    normalized_query = normalize_text(
        query.lower()
    )

    normalized_chunk = normalize_text(
        document["content"].lower()
    )

    if (
        len(normalized_query) >= 5
        and normalized_query
        in normalized_chunk
    ):
        score += 6.0

    # =====================================================
    # 4. FILENAME MATCH
    # =====================================================

    file_tokens = filename_tokens(
        document["source"]
    )

    filename_matches = (
        query_set.intersection(
            file_tokens
        )
    )

    if filename_matches:

        score += (
            len(filename_matches)
            * 2.5
        )

    # =====================================================
    # 5. TOPIC MATCH
    # =====================================================

    topic_score = topic_scores.get(
        document["source"],
        0,
    )

    if topic_score:

        score += (
            topic_score * 4.0
        )

    # =====================================================
    # 6. ANSWER-BEARING CONTENT BONUS
    # =====================================================

    word_count = len(
        document["content"].split()
    )

    if word_count >= 10:
        score += 2.0

    if word_count >= 20:
        score += 1.0

    # =====================================================
    # 7. SPECIFIC QUERY DETAIL BONUS
    # =====================================================
    #
    # Give extra weight to details that identify a specific
    # answer, rather than generic words.
    #
    # Examples:
    #
    # "Friday"
    # "Monday"
    # "Saturday"
    # "6"
    # "AM"
    # "PM"
    #
    # This prevents a Monday opening-hours chunk from
    # competing too strongly with a Friday chunk merely
    # because both contain "8:00 AM - 6:00 PM".
    #
    # =====================================================

    specific_tokens = {
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "am",
        "pm",
    }

    specific_query_tokens = (
        query_set.intersection(
            specific_tokens
        )
    )

    specific_matches = (
        specific_query_tokens.intersection(
            chunk_set
        )
    )

    if specific_matches:

        score += (
            len(specific_matches)
            * 7.0
        )

    # =====================================================
    # 8. NUMERIC DETAIL MATCH
    # =====================================================
    #
    # Useful for queries involving:
    #
    # - opening times
    # - appointment times
    # - quantities
    # - dates
    #
    # =====================================================

    query_numbers = set(
        re.findall(
            r"\b\d+(?:\.\d+)?\b",
            query.lower(),
        )
    )

    chunk_numbers = set(
        re.findall(
            r"\b\d+(?:\.\d+)?\b",
            document["content"].lower(),
        )
    )

    numeric_matches = (
        query_numbers.intersection(
            chunk_numbers
        )
    )

    if numeric_matches:

        score += (
            len(numeric_matches)
            * 4.0
        )

    # =====================================================
    # 9. HEADING-ONLY PENALTY
    # =====================================================

    if looks_like_heading(
        document["content"]
    ):
        score *= 0.35

    return score


# =========================================================
# RETRIEVE KNOWLEDGE
# =========================================================

def retrieve_knowledge(
    query: str,
    top_k: int = 2,
):
    """
    Retrieve the strongest answer-bearing knowledge
    chunks for the query.
    """

    if not query or not query.strip():
        return []

    documents = load_documents()

    if not documents:
        return []

    query_tokens = tokenize(
        query
    )

    if not query_tokens:
        return []

    idf = calculate_idf(
        documents
    )

    topic_scores = detect_topics(
        query
    )

    scored_results = []

    for document in documents:

        score = score_chunk(
            query=query,
            query_tokens=query_tokens,
            document=document,
            idf=idf,
            topic_scores=topic_scores,
        )

        if score <= 0:
            continue

        scored_results.append(
            {
                "source": document["source"],
                "chunk_id": document["chunk_id"],
                "content": document["content"],
                "score": round(
                    score,
                    3,
                ),
            }
        )

    if not scored_results:
        return []

    # =====================================================
    # SORT
    # =====================================================

    scored_results.sort(
        key=lambda item: item["score"],
        reverse=True,
    )

    # =====================================================
    # ABSOLUTE RELEVANCE THRESHOLD
    # =====================================================

    best_score = (
        scored_results[0]["score"]
    )

    if best_score < 2.5:
        return []

    # =====================================================
    # RELATIVE RELEVANCE FILTER
    # =====================================================

    minimum_relative_score = (
        best_score * 0.55
    )

    filtered_results = [
        result
        for result in scored_results
        if result["score"]
        >= minimum_relative_score
    ]

    # =====================================================
    # REMOVE DUPLICATE CONTENT
    # =====================================================

    final_results = []

    seen_content = set()

    for result in filtered_results:

        content_key = (
            result["source"],
            result["content"].strip().lower(),
        )

        if content_key in seen_content:
            continue

        seen_content.add(
            content_key
        )

        final_results.append(
            result
        )

        if len(final_results) >= top_k:
            break

    return final_results