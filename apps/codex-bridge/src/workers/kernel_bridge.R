#!/usr/bin/env Rscript
# Small persistent R kernel used by the APEX execution runtime.
args <- commandArgs(trailingOnly = TRUE)
codefile <- args[1]
options(warn = 1)

json_escape <- function(s) {
  if (length(s) != 1) s <- paste(s, collapse = "\n")
  if (is.na(s)) return("")
  s <- gsub("\\", "\\\\", s, fixed = TRUE)
  s <- gsub("\"", "\\\"", s, fixed = TRUE)
  s <- gsub("\n", "\\n", s, fixed = TRUE)
  s <- gsub("\r", "\\r", s, fixed = TRUE)
  s <- gsub("\t", "\\t", s, fixed = TRUE)
  gsub("[[:cntrl:]]", "", s)
}

emit <- function(id, ok, out, result, error) {
  fields <- c(
    paste0("\"id\":\"", json_escape(id), "\""),
    paste0("\"ok\":", if (ok) "true" else "false"),
    paste0("\"stdout\":\"", json_escape(out), "\""),
    if (is.null(result)) "\"result\":null" else paste0("\"result\":\"", json_escape(result), "\""),
    if (is.null(error)) "\"error\":null" else paste0("\"error\":\"", json_escape(error), "\"")
  )
  cat(paste0("{", paste(fields, collapse = ","), "}"), "\n", sep = "")
  flush(stdout())
}

run_cell <- function(code) {
  expressions <- tryCatch(parse(text = code), error = function(e) e)
  if (inherits(expressions, "error")) {
    return(list(ok = FALSE, stdout = "", result = NULL, error = paste0("Error: ", conditionMessage(expressions))))
  }
  captured <- character(0)
  buffer <- textConnection("captured", open = "w", local = TRUE)
  sink(buffer)
  sink(buffer, type = "message")
  result <- NULL
  error <- NULL
  tryCatch({
    count <- length(expressions)
    if (count > 0) for (index in seq_len(count)) {
      value <- withVisible(eval(expressions[[index]], envir = globalenv()))
      if (value$visible) {
        printed <- paste(utils::capture.output(print(value$value)), collapse = "\n")
        if (index == count) result <- printed else cat(printed, "\n", sep = "")
      }
    }
  }, error = function(e) error <<- paste0("Error: ", conditionMessage(e)))
  sink(type = "message")
  sink()
  close(buffer)
  list(ok = is.null(error), stdout = paste(captured, collapse = "\n"), result = result, error = error)
}

connection <- file("stdin", open = "r")
repeat {
  line <- readLines(connection, n = 1)
  if (length(line) == 0) break
  id <- trimws(line)
  if (nchar(id) == 0) next
  code <- tryCatch(paste(readLines(codefile, warn = FALSE), collapse = "\n"), error = function(e) "")
  value <- run_cell(code)
  emit(id, value$ok, value$stdout, value$result, value$error)
}
