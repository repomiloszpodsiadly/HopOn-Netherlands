package com.hopon.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.net.URI;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(InvalidCatalogRequestException.class)
    public ResponseEntity<ProblemDetail> handleInvalidRequest(
            InvalidCatalogRequestException exception,
            HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, exception.getMessage(), request);
    }

    @ExceptionHandler(PlaceNotFoundException.class)
    public ResponseEntity<ProblemDetail> handlePlaceNotFound(
            PlaceNotFoundException exception,
            HttpServletRequest request) {
        return problem(HttpStatus.NOT_FOUND, exception.getMessage(), request);
    }

    @ExceptionHandler({
            ServletRequestBindingException.class,
            MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class
    })
    public ResponseEntity<ProblemDetail> handleMalformedRequest(HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "The request contains invalid or malformed parameters.", request);
    }

    private static ResponseEntity<ProblemDetail> problem(
            HttpStatus status,
            String detail,
            HttpServletRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(status.getReasonPhrase());
        problem.setInstance(URI.create(request.getRequestURI()));
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }
}
