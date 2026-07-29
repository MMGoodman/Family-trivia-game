// הניקוד לעולם לא נשמר — הוא מחושב מחדש מהרישומים בכל רגע.
// זו הסיבה שתיקון של תשובה נכונה או של רישום שגוי מתקן את הטבלה מיד.

export function computeScores(groups, questions, votes) {
  const correct = new Map()
  for (const q of questions) {
    const right = (q.answers || []).find((a) => a.is_correct)
    if (right) correct.set(q.id, { answerId: right.id, weight: q.weight })
  }

  const points = new Map(groups.map((g) => [g.id, g.adjustment || 0]))
  const hits = new Map(groups.map((g) => [g.id, 0]))

  for (const v of votes) {
    const c = correct.get(v.question_id)
    if (c && v.answer_id === c.answerId) {
      points.set(v.group_id, (points.get(v.group_id) || 0) + c.weight)
      hits.set(v.group_id, (hits.get(v.group_id) || 0) + 1)
    }
  }

  return groups
    .map((g) => ({ ...g, score: points.get(g.id) || 0, correctCount: hits.get(g.id) || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'he'))
}

// דירוג עם טיפול בתיקו: שתי קבוצות עם אותו ניקוד מקבלות אותו מקום
export function withRanks(scored) {
  let lastScore = null
  let lastRank = 0
  return scored.map((g, i) => {
    const rank = g.score === lastScore ? lastRank : i + 1
    lastScore = g.score
    lastRank = rank
    return { ...g, rank }
  })
}

export function correctAnswerOf(question) {
  return (question?.answers || []).find((a) => a.is_correct) || null
}
