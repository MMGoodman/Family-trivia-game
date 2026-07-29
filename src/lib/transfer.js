import { supabase } from './supabase'
import { loadFullGame } from './api'

// ייצוא/ייבוא של משחק שלם כקובץ JSON — גיבוי, שכפול, והעברה בין חשבונות.
// הערה: תמונות נשארות באחסון הענן; הקובץ שומר את הנתיב אליהן.

export async function exportGame(gameId) {
  const { game, groups, questions, votes } = await loadFullGame(gameId)

  const payload = {
    format: 'family-trivia/v1',
    exported_at: new Date().toISOString(),
    game: { name: game.name, description: game.description },
    groups: groups.map((g) => ({ name: g.name, position: g.position, adjustment: g.adjustment })),
    questions: questions.map((q) => ({
      text: q.text,
      image_path: q.image_path,
      weight: q.weight,
      position: q.position,
      answers: q.answers.map((a) => ({ text: a.text, is_correct: a.is_correct, position: a.position })),
    })),
    votes_count: votes.length,
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${game.name.replace(/[\\/:*?"<>|]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importGame(payload) {
  if (payload?.format !== 'family-trivia/v1') {
    throw new Error('קובץ בפורמט לא מוכר')
  }

  const { data: userData } = await supabase.auth.getUser()

  const { data: game, error } = await supabase
    .from('games')
    .insert({
      owner_id: userData.user.id,
      name: `${payload.game.name} (יובא)`,
      description: payload.game.description,
    })
    .select()
    .single()
  if (error) throw error

  if (payload.groups?.length) {
    const res = await supabase
      .from('groups')
      .insert(payload.groups.map((g) => ({ ...g, game_id: game.id })))
    if (res.error) throw res.error
  }

  // הכל בשתי בקשות מרוכזות — כל השאלות, ואז כל התשובות.
  // כך הייבוא לוקח שניות ולא נקטע באמצע.
  const questions = payload.questions || []
  if (questions.length) {
    const { data: inserted, error: qErr } = await supabase
      .from('questions')
      .insert(
        questions.map((q, i) => ({
          game_id: game.id,
          text: q.text,
          image_path: q.image_path,
          weight: q.weight,
          position: q.position ?? i,
        })),
      )
      .select()
    if (qErr) throw qErr
    if (inserted.length !== questions.length) {
      throw new Error(`נשמרו רק ${inserted.length} מתוך ${questions.length} שאלות`)
    }

    // הסדר בתשובה זהה לסדר השליחה — משדכים לפי אינדקס
    const answerRows = questions.flatMap((q, i) =>
      (q.answers || []).map((a) => ({ ...a, question_id: inserted[i].id })),
    )
    if (answerRows.length) {
      const aRes = await supabase.from('answers').insert(answerRows)
      if (aRes.error) throw aRes.error
    }
  }

  return game
}
