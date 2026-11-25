-- Synthetic library content for the local QA stack (production has its own).
insert into library_items (id, kind, title, skill, level_min, level_max, minutes, body_html, questions) values
 ('qa-lib-1', 'article', 'QA: Ocean currents', 'reading', 'B1', 'B2', 10,
  'Ocean currents move warm water from the equator towards the poles. The Gulf Stream keeps western Europe mild in winter.',
  '[{"id":"q1","type":"mc","prompt":"What does the Gulf Stream do?","options":["Cools Africa","Keeps western Europe mild","Stops rain"]},
    {"id":"q2","type":"gap","prompt":"Currents move warm water from the ____.","max_words":1}]')
on conflict (id) do nothing;
insert into library_answer_keys (item_id, answers) values
 ('qa-lib-1', '{"q1":{"answer":1},"q2":{"accepted":["equator"]}}') on conflict do nothing;
