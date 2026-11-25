-- Synthetic library content for the local QA stack (production has its own).
insert into library_items (id, kind, title, skill, level_min, level_max, minutes, body_html, questions) values
 ('qa-lib-1', 'article', 'QA: Ocean currents', 'reading', 'B1', 'B2', 10,
  'Ocean currents move warm water from the equator towards the poles. The Gulf Stream keeps western Europe mild in winter.',
  '[{"id":"q1","type":"mc","prompt":"What does the Gulf Stream do?","options":["Cools Africa","Keeps western Europe mild","Stops rain"]},
    {"id":"q2","type":"gap","prompt":"Currents move warm water from the ____.","max_words":1}]')
on conflict (id) do nothing;
insert into library_answer_keys (item_id, answers) values
 ('qa-lib-1', '{"q1":{"answer":1},"q2":{"accepted":["equator"]}}') on conflict do nothing;

-- A published IELTS Academic reading test (3 passages, 13 + 13 + 14 questions)
-- for the online mock walkthrough. Answers: odd questions TRUE, even FALSE.
insert into library_tests (id, skill, title, level, status, sections, question_count, published_at)
select '00000000-0000-4000-8000-00000000a001', 'reading', 'QA Reading Test', 'B2', 'published',
  (select jsonb_agg(jsonb_build_object('id', 's' || p, 'title', 'Passage ' || p,
      'passage', repeat('Ocean currents move warm water from the equator towards the poles. ', 12),
      'groups', '[]'::jsonb,
      'questions', (select jsonb_agg(jsonb_build_object('id', 'q' || n, 'type', 'tfng', 'prompt', 'Statement ' || n) order by n)
                    from generate_series(case p when 1 then 1 when 2 then 14 else 27 end, case p when 1 then 13 when 2 then 26 else 40 end) n)) order by p)
   from generate_series(1, 3) p),
  40, now()
on conflict (id) do nothing;
insert into library_test_keys (test_id, answers)
select '00000000-0000-4000-8000-00000000a001',
  (select jsonb_object_agg('q' || n, jsonb_build_object('answer', case when n % 2 = 1 then 'true' else 'false' end)) from generate_series(1, 40) n)
on conflict (test_id) do nothing;
