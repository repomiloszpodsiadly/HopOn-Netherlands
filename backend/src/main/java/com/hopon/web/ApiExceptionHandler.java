package com.hopon.web;

import com.hopon.plans.api.InvalidPlanRequestException;
import com.hopon.plans.api.PlanNotFoundException;
import com.hopon.plans.api.PlanLimitReachedException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.net.URI;

@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(ApiExceptionHandler.class);

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

    @ExceptionHandler(InvalidPlanRequestException.class)
    public ResponseEntity<ProblemDetail> handleInvalidPlanRequest(
            InvalidPlanRequestException exception,
            HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, exception.getMessage(), request);
    }

    @ExceptionHandler(PlanLimitReachedException.class)
    public ResponseEntity<ProblemDetail> handlePlanLimit(
            PlanLimitReachedException exception, HttpServletRequest request) {
        return problem(HttpStatus.CONFLICT, exception.getMessage(), request);
    }

    @ExceptionHandler(PlanNotFoundException.class)
    public ResponseEntity<ProblemDetail> handlePlanNotFound(
            PlanNotFoundException exception,
            HttpServletRequest request) {
        return problem(HttpStatus.NOT_FOUND, exception.getMessage(), request);
    }

    @ExceptionHandler({
            ServletRequestBindingException.class,
            MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class,
            MethodArgumentNotValidException.class
    })
    public ResponseEntity<ProblemDetail> handleMalformedRequest(HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "The request contains invalid or malformed parameters.", request);
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ProblemDetail> handlePersistenceFailure(
            DataAccessException exception,
            HttpServletRequest request) {
        LOGGER.error("Persistence failed while handling {}", request.getRequestURI(), exception);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "The request could not be completed.", request);
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
