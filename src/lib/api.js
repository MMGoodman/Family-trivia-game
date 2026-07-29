import { supabase } from './supabase'

// ---------- משחקים ----------

export async function listGames() {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createGame(name, description = '') {
  const { data: userData } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('games')
    .insert({ name, description, owner_id: userData.user.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateGame(id, patch) {
  const { data, error } = await supabase
    .from('games')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteGame(id) {
  const { error } = await supabase.from('games').delete().eq('id', id)
  if (error) throw error
}

// טוען את כל המשחק בבת אחת — קבוצות, שאלות עם תשובות, והרישומים.
// כל טעינה מוצלחת נשמרת מקומית, כך שאם הרשת נופלת באמצע המשחק
// ממשיכים מהעותק האחרון במקום לקבל מסך שבור.
export async function loadFullGame(gameId) {
  try {
    const fresh = await fetchFullGame(gameId)
    try {
      localStorage.setItem(`trivia-cache-${gameId}`, JSON.stringify(fresh))
    } catch { /* אין מקום — לא קריטי */ }
    return fresh
  } catch (err) {
    const cached = localStorage.getItem(`trivia-cache-${gameId}`)
    if (cached) return { ...JSON.parse(cached), stale: true }
    throw err
  }
}

async function fetchFullGame(gameId) {
  const [game, groups, questions] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    supabase.from('groups').select('*').eq('game_id', gameId).order('position'),
    supabase
      .from('questions')
      .select('*, answers(*)')
      .eq('game_id', gameId)
      .order('position'),
  ])
  if (game.error) throw game.error
  if (groups.error) throw groups.error
  if (questions.error) throw questions.error

  const questionIds = questions.data.map((q) => q.id)
  let votes = []
  if (questionIds.length) {
    const res = await supabase.from('votes').select('*').in('question_id', questionIds)
    if (res.error) throw res.error
    votes = res.data
  }

  const withSortedAnswers = questions.data.map((q) => ({
    ...q,
    answers: [...(q.answers || [])].sort((a, b) => a.position - b.position),
  }))

  return { game: game.data, groups: groups.data, questions: withSortedAnswers, votes }
}

// ---------- קבוצות ----------

export async function addGroup(gameId, name, position) {
  const { data, error } = await supabase
    .from('groups')
    .insert({ game_id: gameId, name, position })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateGroup(id, patch) {
  const { data, error } = await supabase.from('groups').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteGroup(id) {
  const { error } = await supabase.from('groups').delete().eq('id', id)
  if (error) throw error
}

// ---------- שאלות ----------

export async function addQuestion(gameId, position) {
  const { data, error } = await supabase
    .from('questions')
    .insert({ game_id: gameId, text: '', weight: 1, position })
    .select()
    .single()
  if (error) throw error

  // שלוש תשובות ריקות כברירת מחדל
  const rows = [0, 1, 2].map((i) => ({ question_id: data.id, text: '', position: i }))
  const ans = await supabase.from('answers').insert(rows).select()
  if (ans.error) throw ans.error

  return { ...data, answers: ans.data.sort((a, b) => a.position - b.position) }
}

export async function updateQuestion(id, patch) {
  const { data, error } = await supabase
    .from('questions')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteQuestion(id) {
  const { error } = await supabase.from('questions').delete().eq('id', id)
  if (error) throw error
}

export async function reorderQuestions(items) {
  // items: [{id, position}]
  await Promise.all(
    items.map((it) => supabase.from('questions').update({ position: it.position }).eq('id', it.id)),
  )
}

// ---------- תשובות ----------

export async function addAnswer(questionId, position) {
  const { data, error } = await supabase
    .from('answers')
    .insert({ question_id: questionId, text: '', position })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateAnswer(id, patch) {
  const { data, error } = await supabase.from('answers').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteAnswer(id) {
  const { error } = await supabase.from('answers').delete().eq('id', id)
  if (error) throw error
}

// סימון תשובה נכונה: מנקה את השאר ומסמן אחת
export async function setCorrectAnswer(questionId, answerId) {
  const clear = await supabase
    .from('answers')
    .update({ is_correct: false })
    .eq('question_id', questionId)
  if (clear.error) throw clear.error
  const { error } = await supabase.from('answers').update({ is_correct: true }).eq('id', answerId)
  if (error) throw error
}

// ---------- הצבעות ----------

export async function castVote(questionId, groupId, answerId) {
  const { data, error } = await supabase
    .from('votes')
    .upsert({ question_id: questionId, group_id: groupId, answer_id: answerId }, {
      onConflict: 'question_id,group_id',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function clearVote(questionId, groupId) {
  const { error } = await supabase
    .from('votes')
    .delete()
    .eq('question_id', questionId)
    .eq('group_id', groupId)
  if (error) throw error
}

// ---------- תמונות ----------

export async function uploadQuestionImage(gameId, questionId, file) {
  const ext = file.name.split('.').pop()
  const path = `${gameId}/${questionId}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('question-images').upload(path, file, {
    upsert: true,
  })
  if (error) throw error
  return path
}

export function imageUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from('question-images').getPublicUrl(path)
  return data.publicUrl
}

export async function removeQuestionImage(path) {
  if (!path) return
  await supabase.storage.from('question-images').remove([path])
}
