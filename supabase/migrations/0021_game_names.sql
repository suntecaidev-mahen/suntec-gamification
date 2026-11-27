-- 0021_game_names.sql
-- Simpler, consistent game names that match the "Play & Win" brand:
--   Year-End Spin → Spin & Win · Festive Scratch Card → Scratch & Win · Suntec City Trivia → Quiz & Win
-- Only renames the demo games if staff haven't already renamed them. Safe to re-run.

update public.game_types set name = 'Quiz & Win' where key = 'quiz' and name = 'Quiz & Trivia';

update public.games set name = 'Spin & Win'    where id = '21000000-0000-4000-8000-000000000001' and name = 'Year-End Spin';
update public.games set name = 'Scratch & Win' where id = '21000000-0000-4000-8000-000000000002' and name = 'Festive Scratch Card';
update public.games set name = 'Quiz & Win'    where id = '21000000-0000-4000-8000-000000000003' and name = 'Suntec City Trivia';

update public.rewards set description = 'One extra spin on Spin & Win'
 where id = '12000000-0000-4000-8000-000000000006' and description = 'One extra spin on the Year-End Spin wheel';

update public.quiz_questions set text = replace(text, 'in the Year-End Spin?', 'in Spin & Win?')
 where text like '%in the Year-End Spin?%';
