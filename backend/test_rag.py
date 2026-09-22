from rag import retrieve_knowledge


queries = [
    "What time does the surgery close on Friday?",
    "How do I get my test results?",
    "Do I need a referral?",
    "What services does the practice provide?",
    "Can I get a repeat prescription?",
    "Can I book an appointment?",
]


for query in queries:

    print("\n" + "=" * 70)
    print("QUERY:", query)
    print("=" * 70)

    results = retrieve_knowledge(
        query,
        top_k=2,
    )

    if not results:
        print("NO RELEVANT KNOWLEDGE")

        continue

    for result in results:

        print(
            f"\nSOURCE: {result['source']}"
        )

        print(
            f"CHUNK: {result['chunk_id']}"
        )

        print(
            f"SCORE: {result['score']}"
        )

        print(
            f"CONTENT:\n{result['content']}"
        )